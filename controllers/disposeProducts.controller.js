const { ObjectId } = require("mongodb");
const { client, db } = require("../db");
const { extractProductId, normalizeIdV2 } = require("../utils/id.util");
const { recalculateAveragePurchasePrice } = require("../services/inventory.service");

const disposeProductsCol = db.collection("dispose_products");
const inventoryCol = db.collection("inventory");
const productsCol = db.collection("products");
const farmingBatchesCol = db.collection("farming_batches");

/* =====================================================
   CREATE DISPOSAL (RECORD LOSS / MORTALITY)
===================================================== */
async function createDisposal(req, res) {
  const session = client.startSession();

  try {
    const {
      batch_id,
      products = [],
      total_loss_amount = 0,
      notes = "",
      date
    } = req.body;

    // 1️⃣ Validations
    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ success: false, message: "At least one product must be selected for disposal" });
    }

    let disposalDate = new Date();
    if (date) {
      const parsedDate = new Date(date);
      if (!isNaN(parsedDate.getTime())) disposalDate = parsedDate;
    }

    const disposalId = new ObjectId();
    const totalLoss = Number(total_loss_amount || 0);

    await session.startTransaction();

    // 2️⃣ Verify batch if selected
    let batchObjId = null;
    let batchName = null;
    if (batch_id) {
      batchObjId = new ObjectId(batch_id);
      const batch = await farmingBatchesCol.findOne({ _id: batchObjId }, { session });
      if (batch) {
        batchName = batch.batch_name || batch.name;
      }
    }

    // 3️⃣ Deduct Disposed Items from Inventory
    for (const item of products) {
      const productIdStr = extractProductId(item.product_id) || item._id;
      if (!productIdStr) continue;

      const productObjId = new ObjectId(productIdStr);
      const disposeQty = Number(item.qty || 0);
      const costPrice = Number(item.cost_price || item.purchase_price || 0);
      const subtotal = Number(item.subtotal || disposeQty * costPrice);

      await inventoryCol.updateOne(
        { product_id: productObjId },
        {
          $inc: { stock_qty: -disposeQty },
          $set: { last_updated: new Date() },
          $push: {
            disposal_history: {
              disposal_id: disposalId.toString(),
              qty: disposeQty,
              cost_price: costPrice,
              subtotal,
              reason: item.reason || "Inventory Loss",
              date: disposalDate
            }
          }
        },
        { session }
      );

      // Recalculate average price if needed
      if (typeof recalculateAveragePurchasePrice === "function") {
        await recalculateAveragePurchasePrice(productObjId, session);
      }
    }

    // 4️⃣ Update Farm Batch Ledger if tied to a specific flock
    if (batchObjId) {
      await farmingBatchesCol.updateOne(
        { _id: batchObjId },
        {
          $push: {
            disposal_history: {
              disposal_id: disposalId,
              date: disposalDate,
              total_loss: totalLoss,
              products
            }
          }
        },
        { session }
      );
    }

    // 5️⃣ Save Disposal Document
    const disposalDoc = {
      _id: disposalId,
      batch_id: batchObjId,
      batch_name: batchName,
      total_loss_amount: totalLoss,
      total_qty: products.reduce((sum, p) => sum + Number(p.qty || 0), 0),
      notes: notes || "",
      date: disposalDate,
      products: products.map((p) => ({
        product_id: new ObjectId(extractProductId(p.product_id) || p._id),
        name: p.name || p.item_name,
        unit: p.unit || "pcs",
        qty: Number(p.qty),
        cost_price: Number(p.cost_price || p.purchase_price || 0),
        subtotal: Number(p.subtotal || Number(p.qty) * Number(p.cost_price || 0)),
        reason: p.reason || "Disposed"
      })),
      created_at: new Date()
    };

    await disposeProductsCol.insertOne(disposalDoc, { session });

    await session.commitTransaction();

    return res.status(201).json({
      success: true,
      message: "Products disposed & inventory written off successfully",
      disposalId
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("Disposal failed:", err);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    await session.endSession();
  }
}

/* =====================================================
   GET ALL DISPOSALS
===================================================== */
async function getDisposals(req, res) {
  try {
    const records = await disposeProductsCol
      .find({})
      .sort({ date: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      count: records.length,
      data: records
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

/* =====================================================
   GET DISPOSAL BY ID
===================================================== */
async function getDisposalById(req, res) {
  try {
    const disposalId = normalizeIdV2(req.params.id, "disposalId");
    const record = await disposeProductsCol.findOne({ _id: disposalId });

    if (!record) {
      return res.status(404).json({ success: false, message: "Disposal record not found" });
    }

    return res.status(200).json({ success: true, data: record });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

/* =====================================================
   DELETE / CANCEL DISPOSAL (RESTORE STOCK)
===================================================== */
async function deleteDisposal(req, res) {
  const session = client.startSession();

  try {
    const disposalId = normalizeIdV2(req.params.id, "disposalId");
    const existing = await disposeProductsCol.findOne({ _id: disposalId });

    if (!existing) {
      return res.status(404).json({ success: false, message: "Disposal record not found" });
    }

    await session.startTransaction();

    // 1️⃣ Revert stock deductions
    for (const item of existing.products || []) {
      const productIdStr = extractProductId(item.product_id);
      if (!productIdStr) continue;

      const productObjId = new ObjectId(productIdStr);
      const returnQty = Number(item.qty || 0);

      await inventoryCol.updateOne(
        { product_id: productObjId },
        {
          $inc: { stock_qty: returnQty },
          $pull: { disposal_history: { disposal_id: disposalId.toString() } },
          $set: { last_updated: new Date() }
        },
        { session }
      );

      if (typeof recalculateAveragePurchasePrice === "function") {
        await recalculateAveragePurchasePrice(productObjId, session);
      }
    }

    // 2️⃣ Pull from Farm Batch history if linked
    if (existing.batch_id) {
      await farmingBatchesCol.updateOne(
        { _id: new ObjectId(existing.batch_id) },
        {
          $pull: { disposal_history: { disposal_id: disposalId } }
        },
        { session }
      );
    }

    // 3️⃣ Delete disposal document
    await disposeProductsCol.deleteOne({ _id: disposalId }, { session });

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: "Disposal record cancelled and inventory restored successfully"
    });
  } catch (err) {
    await session.abortTransaction();
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    await session.endSession();
  }
}

module.exports = {
  createDisposal,
  getDisposals,
  getDisposalById,
  deleteDisposal
};