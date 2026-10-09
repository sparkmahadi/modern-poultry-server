const { ObjectId } = require("mongodb");
const { client, db } = require("../db.js");
const { updateAccountBalance } = require("../services/accountBalance.service.js");
const { increaseInventoryStock, decreaseInventoryStock, addToInventory, recalculateAveragePurchasePrice } = require("../services/inventory.service.js");
const { extractProductId, normalizeIdV2 } = require("../utils/id.util.js");

const purchasesCol = db.collection("purchases");
const productsCol = db.collection("products");
const inventoryCol = db.collection("inventory");
const suppliersCol = db.collection("suppliers");
const purchaseReturnsCol = db.collection("purchase_returns");

/**
 * Standardized Pagination Helper
 */
function extractPagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

// -------------------- GET PURCHASES (PAGINATED) --------------------
async function getPurchases(req, res) {
  try {
    const { type, supplier_id } = req.query;
    const { page, limit, skip } = extractPagination(req.query);

    const matchStage = {};
    if (type === "due") {
      matchStage.payment_due = { $gt: 0 };
    }
    if (supplier_id && ObjectId.isValid(supplier_id)) {
      matchStage.supplier_id = new ObjectId(supplier_id);
    }

    // Execute paginated fetch and count in parallel
    const [purchases, totalRecords] = await Promise.all([
      purchasesCol
        .aggregate([
          { $match: matchStage },
          { $sort: { date: -1 } },
          { $skip: skip },
          { $limit: limit },
          {
            $lookup: {
              from: "suppliers",
              localField: "supplier_id",
              foreignField: "_id",
              as: "supplier"
            }
          },
          {
            $unwind: {
              path: "$supplier",
              preserveNullAndEmptyArrays: true
            }
          },
          {
            $addFields: {
              supplier_name: "$supplier.name"
            }
          },
          {
            $project: {
              supplier: 0
            }
          }
        ])
        .toArray(),
      purchasesCol.countDocuments(matchStage)
    ]);

    res.status(200).json({
      success: true,
      count: purchases.length,
      data: purchases,
      pagination: {
        total: totalRecords,
        page,
        limit,
        totalPages: Math.ceil(totalRecords / limit)
      }
    });

  } catch (err) {
    console.error("getPurchases error:", err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
}

// -------------------- GET PURCHASE REPORT (FACETED & PAGINATED) --------------------
async function getPurchaseReport(req, res) {
  try {
    const { type } = req.params;
    const { date, month, year, from, to, dueOnly } = req.query;
    const { page, limit, skip } = extractPagination(req.query);

    let matchQuery = {};

    /* ------------------------------
       DAILY REPORT
    ------------------------------ */
    if (type === "daily") {
      if (!date) return res.status(400).json({ success: false, message: "Date is required" });
      const start = new Date(date);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setUTCHours(23, 59, 59, 999);
      matchQuery.date = { $gte: start, $lte: end };
    }

    /* ------------------------------
       MONTHLY REPORT
    ------------------------------ */
    else if (type === "monthly") {
      const numMonth = Number(month);
      const numYear = Number(year);
      if (!numMonth || !numYear) return res.status(400).json({ success: false, message: "Month and year are required" });

      const start = new Date(Date.UTC(numYear, numMonth - 1, 1, 0, 0, 0));
      const end = new Date(Date.UTC(numYear, numMonth, 0, 23, 59, 59, 999));
      matchQuery.date = { $gte: start, $lte: end };
    }

    /* ------------------------------
       YEARLY REPORT
    ------------------------------ */
    else if (type === "yearly") {
      const numYear = Number(year);
      if (!numYear) return res.status(400).json({ success: false, message: "Year is required" });

      const start = new Date(Date.UTC(numYear, 0, 1, 0, 0, 0));
      const end = new Date(Date.UTC(numYear, 11, 31, 23, 59, 59, 999));
      matchQuery.date = { $gte: start, $lte: end };
    }

    /* ------------------------------
       CUSTOM RANGE REPORT
    ------------------------------ */
    else if (type === "range") {
      if (!from || !to) return res.status(400).json({ success: false, message: "From and To dates are required" });

      const start = new Date(from);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(to);
      end.setUTCHours(23, 59, 59, 999);
      matchQuery.date = { $gte: start, $lte: end };
    }

    else return res.status(400).json({ success: false, message: "Invalid report type" });

    if (dueOnly === "true") matchQuery.payment_due = { $gt: 0 };

    /* ------------------------------
       FACETED AGGREGATION: DATABASE-LEVEL SUMMARY + PAGINATED ROWS
    ------------------------------ */
    const reportAggregation = await purchasesCol.aggregate([
      { $match: matchQuery },
      {
        $facet: {
          summary: [
            {
              $group: {
                _id: null,
                totalAmount: { $sum: "$total_amount" },
                totalPaid: { $sum: "$paid_amount" },
                totalDue: { $sum: "$payment_due" },
                count: { $sum: 1 }
              }
            }
          ],
          paginatedData: [
            { $sort: { date: -1 } },
            { $skip: skip },
            { $limit: limit },
            {
              $lookup: {
                from: "suppliers",
                localField: "supplier_id",
                foreignField: "_id",
                as: "supplier"
              }
            },
            {
              $unwind: {
                path: "$supplier",
                preserveNullAndEmptyArrays: true
              }
            },
            {
              $addFields: {
                supplier_name: "$supplier.name"
              }
            },
            {
              $project: {
                supplier: 0
              }
            }
          ]
        }
      }
    ]).toArray();

    const summaryData = reportAggregation[0].summary[0] || {
      totalAmount: 0,
      totalPaid: 0,
      totalDue: 0,
      count: 0
    };
    const purchasesData = reportAggregation[0].paginatedData;

    res.status(200).json({
      success: true,
      count: purchasesData.length,
      summary: {
        totalAmount: summaryData.totalAmount,
        totalPaid: summaryData.totalPaid,
        totalDue: summaryData.totalDue,
      },
      data: purchasesData,
      pagination: {
        total: summaryData.count,
        page,
        limit,
        totalPages: Math.ceil(summaryData.count / limit)
      }
    });

  } catch (err) {
    console.error("getPurchaseReport error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// -------------------- GET SINGLE PURCHASE --------------------
async function getPurchaseById(req, res) {
  const purchase_id = req.params.id;
  if (!purchase_id || !ObjectId.isValid(purchase_id)) {
    return res.status(400).json({ success: false, message: 'Valid purchase ID required' });
  }
  try {
    const purchase = await purchasesCol.findOne({ _id: new ObjectId(purchase_id) });
    if (!purchase) return res.status(404).json({ success: false, message: "Purchase not found" });
    res.status(200).json({ success: true, data: purchase });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// -------------------- GET PURCHASES BY SUPPLIER (PAGINATED) --------------------
async function getPurchasesBySupplierId(req, res) {
  const { supplierId } = req.params;
  if (!supplierId || !ObjectId.isValid(supplierId)) {
    return res.status(400).json({ success: false, message: 'Valid Supplier ID required' });
  }
  try {
    const { page, limit, skip } = extractPagination(req.query);
    const filter = { supplier_id: new ObjectId(supplierId) };

    const [purchases, totalRecords] = await Promise.all([
      purchasesCol.find(filter).sort({ date: -1 }).skip(skip).limit(limit).toArray(),
      purchasesCol.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      count: purchases.length,
      data: purchases,
      pagination: {
        total: totalRecords,
        page,
        limit,
        totalPages: Math.ceil(totalRecords / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// -------------------- CREATE PURCHASE --------------------
async function createPurchase(req, res) {
  const session = client.startSession();

  try {
    const { products, total_amount, paid_amount = 0, payment_method = "cash", account_id, supplier_id, date } = req.body;
    if (!products || !products.length) return res.status(400).json({ success: false, message: "Products array cannot be empty" });
    if (paid_amount > 0 && !account_id) return res.status(400).json({ success: false, message: "Account selection is required for payment" });
    if (!date) return res.status(400).json({ success: false, message: "Date is invalid." });

    let purchaseDate;
    if (date) {
      purchaseDate = new Date(date);
      if (isNaN(purchaseDate.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid date format" });
      }
    } else {
      purchaseDate = new Date();
    }

    const invoice_id = new ObjectId();
    const payment_due = total_amount - paid_amount;

    await session.startTransaction();

    await purchasesCol.insertOne({
      _id: invoice_id,
      supplier_id: supplier_id ? new ObjectId(supplier_id) : null,
      products,
      total_amount,
      paid_amount,
      payment_due,
      payment_method,
      account_id: paid_amount > 0 ? new ObjectId(account_id) : null,
      date: purchaseDate,
    }, { session });

    if (paid_amount > 0) {
      const paymentResult = await updateAccountBalance({
        client,
        db,
        amount: paid_amount,
        transactionType: "debit",
        entrySource: "purchase",
        accountId: account_id,
        details: { invoiceId: invoice_id }
      });
      if (!paymentResult.success) throw new Error(paymentResult.message);
    }

    for (const product of products) {
      const result = await addToInventory(product, invoice_id, session);
      if (!result.success) throw new Error(result.message);
    }

    if (supplier_id) {
      const supplierObjId = new ObjectId(supplier_id);
      const balanceDiff = total_amount - paid_amount;
      const advanceDiff = paid_amount > total_amount ? paid_amount - total_amount : 0;
      const dueDiff = balanceDiff > 0 ? balanceDiff : 0;

      await suppliersCol.updateOne(
        { _id: supplierObjId },
        {
          $inc: { total_purchase: total_amount, total_due: dueDiff, due: dueDiff, advance: advanceDiff },
          $set: { last_purchase_date: purchaseDate },
          $push: {
            supplier_history: {
              date: purchaseDate,
              type: "purchase",
              purchase_id: invoice_id,
              products,
              total_amount,
              paid_amount,
              due_after_payment: total_amount - paid_amount,
              remarks: "New purchase created"
            }
          }
        },
        { session }
      );
    }

    await session.commitTransaction();
    return res.status(201).json({ success: true, message: "Purchase processed successfully", invoiceId: invoice_id });

  } catch (err) {
    await session.abortTransaction();
    console.error("Purchase transaction failed:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    await session.endSession();
  }
}

// -------------------- UPDATE PURCHASE --------------------
async function updatePurchase(req, res) {
  const session = client.startSession();

  try {
    const purchaseId = normalizeIdV2(req.params.id, "purchaseId");
    const payload = req.body;

    await session.startTransaction();

    /* 1️⃣ FETCH EXISTING PURCHASE */
    const existingPurchase = await purchasesCol.findOne(
      { _id: purchaseId },
      { session }
    );

    if (!existingPurchase) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Purchase not found"
      });
    }

    /* 2️⃣ REVERT OLD INVENTORY */
    for (const oldProd of existingPurchase.products) {
      const productId = normalizeIdV2(oldProd.product_id, "old product_id");

      await inventoryCol.updateOne(
        { product_id: productId },
        {
          $inc: { stock_qty: -oldProd.qty },
          $pull: {
            purchase_history: { invoice_id: purchaseId.toString() }
          }
        },
        { session }
      );

      await recalculateAveragePurchasePrice(productId, session);
    }

    /* 3️⃣ APPLY NEW INVENTORY */
    if (!Array.isArray(payload.products) || payload.products.length === 0) {
      throw new Error("Products array is empty or invalid");
    }

    for (const newProd of payload.products) {
      const productId = normalizeIdV2(newProd.product_id, "new product_id");

      const purchaseRecord = {
        invoice_id: purchaseId.toString(),
        qty: newProd.qty,
        purchase_price: newProd.purchase_price,
        subtotal: newProd.subtotal,
        date: new Date()
      };

      await inventoryCol.updateOne(
        { product_id: productId },
        {
          $inc: { stock_qty: newProd.qty },
          $push: { purchase_history: purchaseRecord }
        },
        { upsert: true, session }
      );

      await recalculateAveragePurchasePrice(productId, session);
    }

    /* 4️⃣ ACCOUNT BALANCE */
    const oldPaid = existingPurchase.paid_amount || 0;
    const newPaid = payload.paid_amount || 0;

    if (oldPaid > 0 && existingPurchase.account_id) {
      await updateAccountBalance({
        client,
        db,
        amount: oldPaid,
        transactionType: "credit",
        entrySource: "purchase_update",
        accountId: existingPurchase.account_id.toString(),
        details: existingPurchase
      });
    }

    if (newPaid > 0 && payload.account_id) {
      const accountId = normalizeIdV2(payload.account_id, "account_id");

      await updateAccountBalance({
        client,
        db,
        amount: newPaid,
        transactionType: "debit",
        entrySource: "purchase_update",
        accountId: accountId.toString(),
        details: payload
      });
    }

    /* 5️⃣ SUPPLIER UPDATE */
    const supplierId = normalizeIdV2(payload.supplier_id, "supplier_id");

    const oldTotal = existingPurchase.total_amount;
    const newTotal = payload.total_amount;

    const oldDue = oldTotal - oldPaid;
    const newDue = newTotal - newPaid;

    const dueDiff = newDue - oldDue;
    const purchaseDiff = newTotal - oldTotal;

    await suppliersCol.updateOne(
      { _id: supplierId },
      {
        $inc: {
          due: dueDiff,
          total_due: dueDiff,
          total_purchase: purchaseDiff
        },
        $set: {
          last_purchase_date: new Date(),
          updatedAt: new Date()
        }
      },
      { session }
    );

    /* 6️⃣ SUPPLIER HISTORY */
    await suppliersCol.updateOne(
      {
        _id: supplierId,
        "supplier_history.purchase_id": purchaseId
      },
      {
        $set: {
          "supplier_history.$.products": payload.products,
          "supplier_history.$.total_amount": newTotal,
          "supplier_history.$.paid_amount": newPaid,
          "supplier_history.$.due_after_payment": newDue,
          "supplier_history.$.date": new Date(),
          "supplier_history.$.remarks": "Purchase updated"
        }
      },
      { session }
    );

    /* 7️⃣ UPDATE PURCHASE DOCUMENT */
    let purchaseDate = new Date();
    if (payload.date) {
      const parsedDate = new Date(payload.date);
      if (isNaN(parsedDate.getTime())) {
        throw new Error("Invalid date format");
      }
      purchaseDate = parsedDate;
    }

    await purchasesCol.updateOne(
      { _id: purchaseId },
      {
        $set: {
          products: payload.products,
          total_amount: newTotal,
          paid_amount: newPaid,
          payment_due: newDue,
          payment_method: payload.payment_method,
          account_id: payload.account_id
            ? normalizeIdV2(payload.account_id, "account_id")
            : null,
          last_payment_date: new Date(),
          updated_at: new Date(),
          date: purchaseDate,
        }
      },
      { session }
    );

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: "Purchase updated successfully"
    });

  } catch (error) {
    console.error("Update purchase error:", error.message);
    await session.abortTransaction();

    res.status(500).json({
      success: false,
      message: error.message
    });

  } finally {
    await session.endSession();
  }
}

// -------------------- UPDATE ALL PRODUCT PURCHASE PRICES --------------------
async function updateAllProductPrices(req, res) {
  const session = client.startSession();

  try {
    await session.startTransaction();

    const products = await productsCol.find({}, { session }).toArray();

    if (!products.length) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "No products found",
      });
    }

    const inventories = await inventoryCol.find({}, { session }).toArray();
    const inventoryMap = new Map();

    for (const inv of inventories) {
      inventoryMap.set(inv.product_id.toString(), inv);
    }

    const bulkUpdates = [];
    let updatedCount = 0;
    let skippedCount = 0;

    for (const product of products) {
      const productId = product._id.toString();
      const inventory = inventoryMap.get(productId);

      if (!inventory) {
        skippedCount++;
        continue;
      }

      const averagePurchasePrice = Number(inventory.average_purchase_price || 0);
      const lastPurchasePrice = Number(inventory.last_purchase_price || 0);

      bulkUpdates.push({
        updateOne: {
          filter: { _id: product._id },
          update: {
            $set: {
              price: averagePurchasePrice,
              last_purchase_price: lastPurchasePrice,
              updated_at: new Date(),
            },
          },
        },
      });

      updatedCount++;
    }

    if (bulkUpdates.length > 0) {
      await productsCol.bulkWrite(bulkUpdates, { session });
    }

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: "All product prices updated successfully",
      summary: {
        total_products: products.length,
        updated: updatedCount,
        skipped: skippedCount,
      },
    });
  } catch (error) {
    console.error("updateAllProductPrices error:", error.message);
    await session.abortTransaction();
    res.status(500).json({
      success: false,
      message: error.message,
    });
  } finally {
    await session.endSession();
  }
}

// -------------------- PAY SUPPLIER DUE --------------------
async function paySupplierDue(req, res) {
  const purchaseId = new ObjectId(req.params.id);
  const { payAmount, paymentAccountId } = req.body;

  if (!payAmount || payAmount <= 0) return res.status(400).json({ success: false, message: "Invalid payment amount" });
  if (!paymentAccountId) return res.status(400).json({ success: false, message: "Payment account is required" });

  try {
    const purchase = await purchasesCol.findOne({ _id: purchaseId });
    if (!purchase) return res.status(404).json({ success: false, message: "Purchase not found" });

    const oldPaid = Number(purchase.paid_amount || 0);
    const total = Number(purchase.total_amount || 0);
    const due = total - oldPaid;

    const paymentResult = await updateAccountBalance({
      client,
      db,
      amount: payAmount,
      transactionType: "debit",
      entrySource: "supplier_due_payment",
      accountId: paymentAccountId,
      details: { invoiceId: purchaseId, remarks: `Supplier due payment for purchase ${purchaseId}` }
    });
    if (!paymentResult.success) return res.status(400).json(paymentResult);

    const updatedPaid = oldPaid + payAmount;
    const newDue = total - updatedPaid;

    await purchasesCol.updateOne(
      { _id: purchaseId },
      {
        $set: { paid_amount: updatedPaid, payment_due: newDue, paymentAccountId, last_payment_date: new Date() },
        $push: {
          payment_history: {
            date: new Date(),
            paymentAccountId,
            paid_amount: updatedPaid,
            due_after_payment: newDue,
            remarks: "Supplier Specific due payment"
          }
        }
      }
    );

    if (purchase.supplier_id) {
      const supplierId = new ObjectId(purchase.supplier_id);
      await suppliersCol.updateOne(
        { _id: supplierId },
        {
          $inc: { due: -payAmount, advance: 0, total_due: 0 },
          $set: { last_payment_date: new Date() },
          $push: {
            supplier_history: {
              date: new Date(),
              type: "payment",
              purchase_id: purchaseId,
              products: purchase.products,
              total_amount: total,
              paid_amount: updatedPaid,
              due_after_payment: newDue,
              remarks: "Supplier due payment"
            }
          }
        }
      );
    }

    const updatedPurchase = await purchasesCol.findOne({ _id: purchaseId });
    return res.status(200).json({ success: true, message: "Supplier due paid successfully", data: updatedPurchase });

  } catch (err) {
    console.error("paySupplierDue failed:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

// -------------------- DELETE PURCHASE --------------------
async function deletePurchase(req, res) {
  const session = client.startSession();

  try {
    let purchaseId;
    try {
      purchaseId = new ObjectId(req.params.id);
    } catch (e) {
      throw new Error("Invalid purchase ID format");
    }

    const existingPurchase = await purchasesCol.findOne({ _id: purchaseId });
    if (!existingPurchase) {
      return res.status(404).json({ success: false, message: "Purchase not found" });
    }

    await session.startTransaction();

    for (const item of existingPurchase.products) {
      const productIdStr = extractProductId(item.product_id);
      if (!productIdStr) continue;

      const productObjId = new ObjectId(productIdStr);

      await inventoryCol.updateOne(
        { product_id: productObjId },
        {
          $inc: { stock_qty: -item.qty },
          $pull: {
            purchase_history: { invoice_id: purchaseId.toString() }
          }
        },
        { session }
      );

      await recalculateAveragePurchasePrice(item.product_id, session);
    }

    if (existingPurchase.paid_amount > 0 && existingPurchase.account_id) {
      const revertResult = await updateAccountBalance({
        client,
        db,
        amount: existingPurchase.paid_amount,
        transactionType: "credit",
        entrySource: "purchase_delete",
        accountId: existingPurchase.account_id,
        details: { invoiceId: purchaseId, remarks: "Revert payment on delete" }
      });

      if (!revertResult.success) throw new Error(revertResult.message);
    }

    if (existingPurchase.supplier_id) {
      const supplierObjId = new ObjectId(existingPurchase.supplier_id);
      const balanceDiff = existingPurchase.total_amount - existingPurchase.paid_amount;
      const advanceDiff = existingPurchase.paid_amount > existingPurchase.total_amount
        ? existingPurchase.paid_amount - existingPurchase.total_amount
        : 0;
      const dueDiff = balanceDiff > 0 ? balanceDiff : 0;

      await suppliersCol.updateOne(
        { _id: supplierObjId },
        {
          $inc: {
            total_purchase: -existingPurchase.total_amount,
            total_due: -dueDiff,
            due: -dueDiff,
            advance: -advanceDiff
          },
          $set: { last_purchase_date: new Date() },
          $push: {
            supplier_history: {
              date: new Date(),
              type: "deleted_purchase",
              purchase_id: purchaseId,
              products: existingPurchase.products,
              total_amount: existingPurchase.total_amount,
              paid_amount: existingPurchase.paid_amount,
              due_after_payment: balanceDiff,
              remarks: "Purchase deleted"
            }
          }
        },
        { session }
      );
    }

    await purchasesCol.deleteOne({ _id: purchaseId }, { session });
    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: "Purchase deleted successfully"
    });

  } catch (err) {
    await session.abortTransaction();
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    await session.endSession();
  }
}

// -------------------- PAY SUPPLIER DUE MANUALLY (FIFO) --------------------
async function paySupplierDueManually(req, res) {
  const session = client.startSession();
  try {
    const { paidAmount, paymentAccountId, supplierId } = req.body;

    if (!paidAmount || paidAmount <= 0)
      return res.status(400).json({ success: false, message: "Invalid payment amount" });

    if (!paymentAccountId)
      return res.status(400).json({ success: false, message: "Payment account is required" });

    if (!supplierId)
      return res.status(400).json({ success: false, message: "Supplier is required" });

    await session.startTransaction();

    let remainingAmount = Number(paidAmount);

    const purchases = await purchasesCol
      .find({
        supplier_id: new ObjectId(supplierId),
        $expr: {$gt: ["$total_amount", "$paid_amount"] }
      })
      .sort({ date: 1 })
      .toArray();

    for (const purchase of purchases) {
      if (remainingAmount <= 0) break;

      const total = Number(purchase.total_amount || 0);
      const paid = Number(purchase.paid_amount || 0);
      const due = total - paid;

      if (due <= 0) continue;

      const payNow = Math.min(due, remainingAmount);

      const paymentResult = await updateAccountBalance({
        client,
        db,
        amount: payNow,
        transactionType: "debit",
        entrySource: "supplier_due_payment_manual",
        accountId: paymentAccountId,
        details: {
          purchaseId: purchase._id,
          remarks: `Manual supplier payment applied to purchase ${purchase._id}`
        },
        session
      });

      if (!paymentResult.success) throw new Error(paymentResult.message);

      const newPaid = paid + payNow;
      const newDue = total - newPaid;

      await purchasesCol.updateOne(
        { _id: purchase._id },
        {
          $set: {             paid_amount: newPaid,             payment_due: newDue,             paymentAccountId,             last_payment_date: new Date()           },$push: {
            payment_history: {
              date: new Date(),
              paymentAccountId,
              paid_amount: newPaid,
              due_after_payment: newDue,
              remarks: "Supplier Manual due payment"
            }
          }
        },
        { session }
      );

      await suppliersCol.updateOne(
        { _id: new ObjectId(supplierId) },
        {
          $inc: { due: -payNow },
          $set: { last_payment_date: new Date() },$push: {
            supplier_history: {
              date: new Date(),
              type: "payment",
              purchase_id: purchase._id,
              products: purchase.products,
              total_amount: total,
              paid_amount: newPaid,
              due_after_payment: newDue,
              remarks: "Manual supplier due payment"
            }
          }
        },
        { session }
      );

      remainingAmount -= payNow;
    }

    if (remainingAmount > 0) {
      const paymentResult = await updateAccountBalance({
        client,
        db,
        amount: remainingAmount,
        transactionType: "debit",
        entrySource: "supplier_advance_payment_manual",
        accountId: paymentAccountId,
        details: {
          remarks: `Manual advance payment applied to supplier in purchase`
        },
        session
      });

      if (!paymentResult.success) throw new Error(paymentResult.message);

      await suppliersCol.updateOne(
        { _id: new ObjectId(supplierId) },
        {
          $inc: { advance: remainingAmount }
        },
        { session }
      );
    }

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: "Supplier payment distributed successfully",
      summary: {
        totalPaid: paidAmount,
        appliedToDue: paidAmount - remainingAmount,
        advance: remainingAmount
      }
    });

  } catch (err) {
    await session.abortTransaction();
    console.error("paySupplierDueManually failed:", err);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    await session.endSession();
  }
}

// -------------------- PRODUCT-WISE PURCHASE RECORDS (PAGINATED) --------------------
async function getProductWisePurchaseRecord(req, res) {
  try {
    const { page, limit, skip } = extractPagination(req.query);

    // 1. Get total distinct products to compute totalPages
    const distinctProductsResult = await purchasesCol.aggregate([
      { $unwind: "$products" },
      { $group: { _id: "$products.product_id" } },
      { $count: "totalDistinct" }
    ]).toArray();

    const totalRecords = distinctProductsResult.length > 0 ? distinctProductsResult[0].totalDistinct : 0;

    // 2. Aggregate paginated groups
    const result = await purchasesCol
      .aggregate([
        {
          $lookup: {
            from: "suppliers",
            localField: "supplier_id",
            foreignField: "_id",
            as: "supplier",
          },
        },
        {
          $unwind: {
            path: "$supplier",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $unwind: "$products",
        },
        {
          $group: {
            _id: "$products.product_id",
            product_name: {
              $first: "$products.name",
            },
            total_qty: {
              $sum: "$products.qty",
            },
            total_purchase_amount: {
              $sum: "$products.subtotal",
            },
            avg_purchase_price: {
              $avg: "$products.purchase_price",
            },
            total_purchase_count: {
              $sum: 1,
            },
            last_purchase_date: {
              $max: "$date",
            },
            purchases: {
              $push: {
                _id: { $toString: "$_id" },
                supplier_id: { $toString: "$supplier_id" },
                supplier_name: "$supplier.name",
                qty: "$products.qty",
                purchase_price: "$products.purchase_price",
                subtotal: "$products.subtotal",
                payment_method: "$payment_method",
                paid_amount: "$paid_amount",
                payment_due: "$payment_due",
                date: "$date",
              },
            },
          },
        },
        {
          $sort: {             last_purchase_date: -1,           },         },         {$skip: skip },
        { $limit: limit },
        {
          $project: {
            _id: 0,
            product_id: "$_id",
            product_name: 1,
            total_qty: 1,
            total_purchase_amount: 1,
            avg_purchase_price: {
              $round: ["$avg_purchase_price", 2],
            },
            total_purchase_count: 1,
            last_purchase_date: 1,
            purchases: 1,
          },
        },
      ])
      .toArray();

    return res.status(200).json({
      success: true,
      count: result.length,
      data: result,
      pagination: {
        total: totalRecords,
        page,
        limit,
        totalPages: Math.ceil(totalRecords / limit)
      }
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Failed to get product-wise purchase records",
      error: error.message,
    });
  }
}

// -------------------- CREATE PURCHASE RETURN --------------------
async function createPurchaseReturn(req, res) {
  const session = client.startSession();

  try {
    const {
      supplier_id,
      products,
      total_return_amount,
      refund_received,
      refund_amount,
      payment_method,
      account_id,
      paymentAccountId,
      note = "",
      date
    } = req.body;

    const effectiveRefund = Number(refund_received ?? refund_amount ?? 0);
    const effectiveAccountId = account_id || paymentAccountId;

    if (!supplier_id) {
      return res.status(400).json({ success: false, message: "Supplier ID is required" });
    }
    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ success: false, message: "Products list cannot be empty" });
    }
    if (effectiveRefund > 0 && !effectiveAccountId) {
      return res.status(400).json({ success: false, message: "Account selection is required when receiving a cash refund" });
    }

    let returnDate = new Date();
    if (date) {
      const parsedDate = new Date(date);
      if (isNaN(parsedDate.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid date format" });
      }
      returnDate = parsedDate;
    }

    const supplierId = normalizeIdV2(supplier_id, "supplier_id");
    const returnId = new ObjectId();
    const returnAmount = Number(total_return_amount || 0);

    await session.startTransaction();

    const supplier = await suppliersCol.findOne({ _id: supplierId }, { session });
    if (!supplier) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Supplier not found" });
    }

    for (const item of products) {
      const productIdStr = extractProductId(item.product_id);
      if (!productIdStr) continue;

      const productObjId = new ObjectId(productIdStr);
      const returnQty = Number(item.qty || 0);
      const returnPrice = Number(item.return_price || item.purchase_price || 0);
      const subtotal = Number(item.subtotal || returnQty * returnPrice);

      await inventoryCol.updateOne(
        { product_id: productObjId },
        {
          $inc: { stock_qty: -returnQty },$push: {
            return_history: {
              return_id: returnId.toString(),
              qty: returnQty,
              return_price: returnPrice,
              subtotal,
              reason: item.reason || "Return to supplier",
              date: returnDate
            }
          }
        },
        { session }
      );

      await recalculateAveragePurchasePrice(productObjId, session);
    }

    if (effectiveRefund > 0 && effectiveAccountId) {
      const accountObjId = normalizeIdV2(effectiveAccountId, "account_id");

      const paymentResult = await updateAccountBalance({
        client,
        db,
        amount: effectiveRefund,
        transactionType: "credit",
        entrySource: "purchase_return",
        accountId: accountObjId.toString(),
        details: {
          returnId,
          supplierId,
          remarks: `Refund received for purchase return ${returnId}`
        }
      });

      if (!paymentResult.success) throw new Error(paymentResult.message);
    }

    const netReturnCredit = returnAmount - effectiveRefund;
    const currentDue = Number(supplier.due || 0);

    let dueDiff = 0;
    let advanceDiff = 0;

    if (netReturnCredit > 0) {
      if (currentDue >= netReturnCredit) {
        dueDiff = netReturnCredit;
      } else {
        dueDiff = currentDue;
        advanceDiff = netReturnCredit - currentDue;
      }
    } else if (netReturnCredit < 0) {
      dueDiff = netReturnCredit;
    }

    await suppliersCol.updateOne(
      { _id: supplierId },
      {
        $inc: {
          total_purchase: -returnAmount,
          total_due: -dueDiff,
          due: -dueDiff,
          advance: advanceDiff
        },
        $set: { updatedAt: new Date() },$push: {
          supplier_history: {
            date: returnDate,
            type: "purchase_return",
            return_id: returnId,
            products,
            total_amount: returnAmount,
            refund_received: effectiveRefund,
            due_after_return: Math.max(0, currentDue - dueDiff),
            remarks: note || "Purchase return processed"
          }
        }
      },
      { session }
    );

    const returnDoc = {
      _id: returnId,
      supplier_id: supplierId,
      products,
      total_return_amount: returnAmount,
      refund_received: effectiveRefund,
      payment_method: effectiveRefund > 0 ? payment_method : null,
      account_id: effectiveRefund > 0 && effectiveAccountId ? normalizeIdV2(effectiveAccountId, "account_id") : null,
      note,
      date: returnDate,
      created_at: new Date()
    };

    await purchaseReturnsCol.insertOne(returnDoc, { session });
    await session.commitTransaction();

    return res.status(201).json({
      success: true,
      message: "Purchase return recorded successfully",
      returnId
    });

  } catch (err) {
    await session.abortTransaction();
    console.error("Purchase return failed:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    await session.endSession();
  }
}

// -------------------- GET ALL PURCHASE RETURNS (PAGINATED) --------------------
async function getPurchaseReturns(req, res) {
  try {
    const { page, limit, skip } = extractPagination(req.query);

    const [returns, totalRecords] = await Promise.all([
      purchaseReturnsCol
        .aggregate([
          { $sort: { date: -1 } },           {$skip: skip },
          { $limit: limit },
          {
            $lookup: {
              from: "suppliers",
              localField: "supplier_id",
              foreignField: "_id",
              as: "supplier"
            }
          },
          {
            $unwind: {
              path: "$supplier",
              preserveNullAndEmptyArrays: true
            }
          },
          {
            $lookup: {
              from: "payment_accounts",
              localField: "account_id",
              foreignField: "_id",
              as: "account"
            }
          },
          {
            $unwind: {
              path: "$account",
              preserveNullAndEmptyArrays: true
            }
          },
          {
            $addFields: {
              supplier_name: "$supplier.name",
              supplier_phone: "$supplier.phone",
              account_name: "$account.name"
            }
          },
          {
            $project: { supplier: 0, account: 0 }
          }
        ])
        .toArray(),
      purchaseReturnsCol.countDocuments({})
    ]);

    return res.status(200).json({
      success: true,
      count: returns.length,
      data: returns,
      pagination: {
        total: totalRecords,
        page,
        limit,
        totalPages: Math.ceil(totalRecords / limit)
      }
    });
  } catch (err) {
    console.error("getPurchaseReturns error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

// -------------------- GET SINGLE PURCHASE RETURN --------------------
async function getPurchaseReturnById(req, res) {
  try {
    const returnId = normalizeIdV2(req.params.id, "returnId");
    
    const result = await purchaseReturnsCol.aggregate([
      { $match: { _id: returnId } },
      {
        $lookup: {
          from: "suppliers",
          localField: "supplier_id",
          foreignField: "_id",
          as: "supplier"
        }
      },
      { $unwind: { path: "$supplier", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "payment_accounts",
          localField: "account_id",
          foreignField: "_id",
          as: "account"
        }
      },
      { $unwind: { path: "$account", preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          supplier_name: "$supplier.name",
          supplier_phone: "$supplier.phone",
          due: "$supplier.due",
          advance: "$supplier.advance",
          account_name: "$account.name"
        }
      },
      { $project: { supplier: 0, account: 0 } }
    ]).toArray();

    if (!result || result.length === 0) {
      return res.status(404).json({ success: false, message: "Purchase return not found" });
    }

    return res.status(200).json({ success: true, data: result[0] });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// -------------------- UPDATE PURCHASE RETURN BY ID --------------------
async function updatePurchaseReturn(req, res) {
  const session = client.startSession();

  try {
    const returnId = normalizeIdV2(req.params.id, "returnId");
    const {
      supplier_id,
      products = [],
      total_return_amount,
      refund_received,
      refund_amount,
      payment_method,
      account_id,
      paymentAccountId,
      note = "",
      date
    } = req.body;

    const newRefund = Number(refund_received ?? refund_amount ?? 0);
    const newTotal = Number(total_return_amount || 0);
    const newAccountId = account_id || paymentAccountId;

    if (!supplier_id) {
      return res.status(400).json({ success: false, message: "Supplier ID is required" });
    }
    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ success: false, message: "Products list cannot be empty" });
    }
    if (newRefund > 0 && !newAccountId) {
      return res.status(400).json({ 
        success: false, 
        message: "Payment account selection is required when receiving a cash refund" 
      });
    }

    await session.startTransaction();

    const existingReturn = await purchaseReturnsCol.findOne({ _id: returnId }, { session });
    if (!existingReturn) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Purchase return record not found" });
    }

    const supplierId = normalizeIdV2(supplier_id, "supplier_id");
    const supplier = await suppliersCol.findOne({ _id: supplierId }, { session });
    if (!supplier) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Supplier not found" });
    }

    for (const item of existingReturn.products || []) {
      const productIdStr = extractProductId(item.product_id);
      if (!productIdStr) continue;

      const productObjId = new ObjectId(productIdStr);
      const oldQty = Number(item.qty || 0);

      await inventoryCol.updateOne(
        { product_id: productObjId },
        {
          $inc: { stock_qty: oldQty },$pull: { return_history: { return_id: returnId.toString() } }
        },
        { session }
      );

      await recalculateAveragePurchasePrice(productObjId, session);
    }

    const oldRefund = Number(existingReturn.refund_received ?? existingReturn.refund_amount ?? 0);
    const oldAccountIdRaw = existingReturn.account_id || existingReturn.paymentAccountId;
    const oldAccountIdStr = oldAccountIdRaw ? oldAccountIdRaw.toString() : null;
    const newAccountIdStr = newAccountId ? normalizeIdV2(newAccountId, "account_id").toString() : null;

    if (oldAccountIdStr && newAccountIdStr && oldAccountIdStr === newAccountIdStr) {
      const refundDiff = newRefund - oldRefund;

      if (refundDiff > 0) {
        const paymentResult = await updateAccountBalance({
          client,
          db,
          amount: refundDiff,
          transactionType: "credit",
          entrySource: "purchase_return_update",
          accountId: newAccountIdStr,
          details: {
            returnId,
            supplierId,
            remarks: `Net refund increase for return #${returnId.toString().slice(-6)}`
          },
          session
        });
        if (!paymentResult.success) throw new Error(paymentResult.message);
      } else if (refundDiff < 0) {
        const paymentResult = await updateAccountBalance({
          client,
          db,
          amount: Math.abs(refundDiff),
          transactionType: "debit",
          entrySource: "purchase_return_update",
          accountId: newAccountIdStr,
          details: {
            returnId,
            supplierId,
            remarks: `Net refund reduction for return #${returnId.toString().slice(-6)}`
          },
          session
        });
        if (!paymentResult.success) throw new Error(paymentResult.message);
      }
    } else {
      if (oldRefund > 0 && oldAccountIdStr) {
        const revertResult = await updateAccountBalance({
          client,
          db,
          amount: oldRefund,
          transactionType: "debit",
          entrySource: "purchase_return_update",
          accountId: oldAccountIdStr,
          details: {
            returnId,
            remarks: `Revert refund on account switch for return #${returnId.toString().slice(-6)}`
          },
          session
        });
        if (!revertResult.success) throw new Error(revertResult.message);
      }

      if (newRefund > 0 && newAccountIdStr) {
        const paymentResult = await updateAccountBalance({
          client,
          db,
          amount: newRefund,
          transactionType: "credit",
          entrySource: "purchase_return_update",
          accountId: newAccountIdStr,
          details: {
            returnId,
            supplierId,
            remarks: `Deposit refund on account switch for return #${returnId.toString().slice(-6)}`
          },
          session
        });
        if (!paymentResult.success) throw new Error(paymentResult.message);
      }
    }

    const oldTotal = Number(existingReturn.total_return_amount || 0);
    const oldNetCredit = oldTotal - oldRefund;

    await suppliersCol.updateOne(
      { _id: new ObjectId(existingReturn.supplier_id) },
      {
        $inc: {
          total_purchase: oldTotal,
          due: oldNetCredit,
          total_due: oldNetCredit > 0 ? oldNetCredit : 0
        }
      },
      { session }
    );

    let returnDate = existingReturn.date;
    if (date) {
      const parsed = new Date(date);
      if (!isNaN(parsed.getTime())) returnDate = parsed;
    }

    for (const item of products) {
      const productIdStr = extractProductId(item.product_id);
      if (!productIdStr) continue;

      const productObjId = new ObjectId(productIdStr);
      const newQty = Number(item.qty || 0);
      const newPrice = Number(item.return_price || item.purchase_price || 0);
      const subtotal = Number(item.subtotal || newQty * newPrice);

      await inventoryCol.updateOne(
        { product_id: productObjId },
        {
          $inc: { stock_qty: -newQty },$push: {
            return_history: {
              return_id: returnId.toString(),
              qty: newQty,
              return_price: newPrice,
              subtotal,
              reason: item.reason || "Return to supplier",
              date: returnDate
            }
          }
        },
        { session }
      );

      await recalculateAveragePurchasePrice(productObjId, session);
    }

    const newNetCredit = newTotal - newRefund;
    const currentSupplier = await suppliersCol.findOne({ _id: supplierId }, { session });
    const currentDue = Number(currentSupplier?.due || 0);

    let dueDiff = 0;
    let advanceDiff = 0;

    if (newNetCredit > 0) {
      if (currentDue >= newNetCredit) {
        dueDiff = newNetCredit;
      } else {
        dueDiff = currentDue;
        advanceDiff = newNetCredit - currentDue;
      }
    } else if (newNetCredit < 0) {
      dueDiff = newNetCredit;
    }

    await suppliersCol.updateOne(
      { _id: supplierId },
      {
        $inc: {
          total_purchase: -newTotal,
          total_due: -dueDiff,
          due: -dueDiff,
          advance: advanceDiff
        },
        $set: { updatedAt: new Date() },$push: {
          supplier_history: {
            date: returnDate,
            type: "purchase_return_updated",
            return_id: returnId,
            products,
            total_amount: newTotal,
            refund_received: newRefund,
            due_after_return: Math.max(0, currentDue - dueDiff),
            remarks: note || "Purchase return updated"
          }
        }
      },
      { session }
    );

    await purchaseReturnsCol.updateOne(
      { _id: returnId },
      {
        $set: {
          supplier_id: supplierId,
          products: products.map((p) => ({
            product_id: new ObjectId(extractProductId(p.product_id) || p._id),
            name: p.name || p.item_name,
            unit: p.unit || "pcs",
            qty: Number(p.qty),
            return_price: Number(p.return_price || p.purchase_price || 0),
            subtotal: Number(p.subtotal || 0),
            reason: p.reason || "Return to supplier"
          })),
          total_return_amount: newTotal,
          refund_received: newRefund,
          payment_method: newRefund > 0 ? payment_method : null,
          account_id: newRefund > 0 && newAccountIdStr ? new ObjectId(newAccountIdStr) : null,
          note,
          date: returnDate,
          updated_at: new Date()
        }
      },
      { session }
    );

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: "Purchase return updated successfully"
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("Update purchase return failed:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    await session.endSession();
  }
}

// -------------------- DELETE / CANCEL PURCHASE RETURN --------------------
async function deletePurchaseReturn(req, res) {
  const session = client.startSession();

  try {
    const returnId = normalizeIdV2(req.params.id, "returnId");
    const existingReturn = await purchaseReturnsCol.findOne({ _id: returnId });

    if (!existingReturn) {
      return res.status(404).json({ success: false, message: "Purchase return record not found" });
    }

    await session.startTransaction();

    for (const item of existingReturn.products || []) {
      const productIdStr = extractProductId(item.product_id);
      if (!productIdStr) continue;

      const productObjId = new ObjectId(productIdStr);
      const returnQty = Number(item.qty || 0);

      await inventoryCol.updateOne(
        { product_id: productObjId },
        {
          $inc: { stock_qty: returnQty },$pull: { return_history: { return_id: returnId.toString() } }
        },
        { session }
      );

      await recalculateAveragePurchasePrice(productObjId, session);
    }

    const refundToRevert = Number(existingReturn.refund_received ?? existingReturn.refund_amount ?? 0);
    const accountToRevert = existingReturn.account_id || existingReturn.paymentAccountId;

    if (refundToRevert > 0 && accountToRevert) {
      const revertResult = await updateAccountBalance({
        client,
        db,
        amount: refundToRevert,
        transactionType: "debit",
        entrySource: "purchase_return_delete",
        accountId: accountToRevert.toString(),
        details: {
          returnId,
          remarks: `Revert refund received on cancelled purchase return #${returnId.toString().slice(-6)}`
        }
      });

      if (!revertResult.success) throw new Error(revertResult.message);
    }

    if (existingReturn.supplier_id) {
      const returnTotal = Number(existingReturn.total_return_amount || 0);
      const netCredit = returnTotal - refundToRevert;

      await suppliersCol.updateOne(
        { _id: new ObjectId(existingReturn.supplier_id) },
        {
          $inc: {
            total_purchase: returnTotal,
            total_due: netCredit > 0 ? netCredit : 0,
            due: netCredit
          },
          $push: {
            supplier_history: {
              date: new Date(),
              type: "cancelled_purchase_return",
              return_id: returnId,
              total_amount: returnTotal,
              remarks: "Purchase return cancelled and reverted"
            }
          }
        },
        { session }
      );
    }

    await purchaseReturnsCol.deleteOne({ _id: returnId }, { session });
    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: "Purchase return cancelled and balances reverted successfully"
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("Delete purchase return failed:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    await session.endSession();
  }
}

module.exports = {
  createPurchase,
  getPurchases,
  getPurchaseById,
  updatePurchase,
  deletePurchase,
  paySupplierDue,
  getPurchaseReport,
  paySupplierDueManually,
  getPurchasesBySupplierId,
  updateAllProductPrices,
  getProductWisePurchaseRecord,
  createPurchaseReturn,
  getPurchaseReturns,
  getPurchaseReturnById,
  updatePurchaseReturn,
  deletePurchaseReturn
};