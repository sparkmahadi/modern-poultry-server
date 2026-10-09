
const { ObjectId } = require("mongodb");
const { db, client } = require("../db");
const batchColl = db.collection("batches");
const salesColl = db.collection("sales");
const purchasesCol = db.collection("purchases");
const inventoryCol = db.collection("inventory");
const customersCol = db.collection("customers");

// ---------------------------------------------
// @desc    Create a new batch
// @route   POST /api/batches
// ---------------------------------------------
module.exports.createBatch = async (req, res) => {
    try {
        const payload = req.body;

        if (!payload || Object.keys(payload).length === 0) {
            return res.status(400).json({ message: "Payload is required" });
        }

        const newBatch = await batchColl.insertOne(payload);

        return res.status(201).json({
            message: "Batch created successfully",
            batchId: newBatch.insertedId,
        });
    } catch (error) {
        console.error("Create Batch Error:", error);
        res.status(500).json({
            message: "Server error while creating batch",
            error: error.message,
        });
    }
};


// ---------------------------------------------
// @desc    Update an existing batch
// @route   PUT /api/batches/:id
// ---------------------------------------------
module.exports.updateBatch = async (req, res) => {
    try {
        const batchId = req.params.id;
        const { _id, ...payload } = req.body;
        console.log(payload)
        if (!batchId) {
            return res.status(400).json({ message: "Batch ID is required" });
        }

        const updated = await batchColl
            .updateOne(
                { _id: new ObjectId(batchId) },
                { $set: payload },
                { returnDocument: "after" }
            );
        if (!updated.acknowledged === 0) {
            return res.status(404).json({ message: "Batch not found" });
        }

        return res.status(200).json({
            success: true,
            message: "Batch updated successfully",
            batch: updated.value,
        });
    } catch (error) {
        console.error("Update Batch Error:", error);
        res.status(500).json({
            message: "Server error while updating batch",
            error: error.message,
        });
    }
};

module.exports.addSellHistory = async (req, res) => {
    try {
        const { memoId, batchId } = req.body;
        console.log(memoId, batchId);
        if (!memoId || !batchId) {
            return res.status(400).json({
                success: false,
                message: "memoId and batchId are required"
            });
        }

        const updated = await batchColl.updateOne(
            { _id: new ObjectId(batchId) },
            { $push: { salesHistoryIds: new ObjectId(memoId) } }
        );

        if (updated.matchedCount === 0) {
            return res.status(404).json({
                success: false,
                message: "Batch not found"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Sale history added to batch successfully",
            batchId
        });

    } catch (error) {
        console.error("addSellHistory Error:", error);
        res.status(500).json({
            success: false,
            message: "Server error while adding sell history",
            error: error.message,
        });
    }
};

module.exports.removeASellHistoryId = async (req, res) => {
    try {
        const { batchId, memoId } = req.body;

        if (!batchId || !memoId) {
            return res.status(400).json({
                success: false,
                message: "batchId and memoId are required"
            });
        }

        const updated = await batchColl.updateOne(
            { _id: new ObjectId(batchId) },
            { $pull: { salesHistoryIds: new ObjectId(memoId) } }
        );

        if (updated.matchedCount === 0) {
            return res.status(404).json({
                success: false,
                message: "Batch not found"
            });
        }

        if (updated.modifiedCount === 0) {
            return res.status(400).json({
                success: false,
                message: "memoId not found in salesHistoryIds"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Sale history removed successfully",
            batchId
        });

    } catch (error) {
        console.error("removeSellHistory Error:", error);
        res.status(500).json({
            success: false,
            message: "Server error while removing sale history",
            error: error.message
        });
    }
};


// GET ALL BATCHES
// ---------------------------------------------
module.exports.getBatches = async (req, res) => {
    try {
        const batches = await batchColl
            .find({})
            .sort({ createdAt: -1 })
            .toArray();

        res.status(200).json({
            message: "Batches fetched successfully",
            success: true,
            batches,
        });
    } catch (error) {
        console.error("Get Batches Error:", error);
        res.status(500).json({
            message: "Server error fetching batches",
            error: error.message,
        });
    }
};


module.exports.getBatchSales = async (req, res) => {
  try {
    const { batchId } = req.params;
    if (!batchId || !ObjectId.isValid(batchId)) {
      return res.status(400).json({ success: false, message: "Valid Batch ID is required" });
    }

    const bId = new ObjectId(batchId);

    // Query sales directly by batch_id (matches both ObjectId and string format)
    const sales = await salesColl
      .find({
        $or: [
          { batch_id: bId },
          { batch_id: batchId }
        ]
      })
      .sort({ date: -1 })
      .toArray();

    return res.status(200).json({ success: true, sales });
  } catch (error) {
    console.error("getBatchSales error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};


// GET SINGLE BATCH BY Customer ID
// ---------------------------------------------
module.exports.getBatchById = async (req, res) => {
    try {
        const { id } = req.params;
        const batch = await batchColl
            .findOne({ _id: new ObjectId(id) });
        console.log(batch)

        if (!batch) {
            return res.status(404).json({ message: "Batch not found" });
        }

        res.status(200).json({
            success: true,
            message: "Batch fetched successfully",
            batch,
        });

    } catch (error) {
        console.error("Get Batch Error:", error);
        res.status(500).json({
            message: "Server error fetching batch",
            error: error.message,
        });
    }
};

// GET SINGLE BATCH BY ID
// ---------------------------------------------
module.exports.getBatchByCustomerId = async (req, res) => {
    try {
        const { customerId } = req.params;
        const batches = await batchColl.find({ farmerId: (customerId) }).toArray();
        console.log(customerId, batches)

        if (!batches.length) {
            return res.status(404).json({ message: "Batch not found" });
        }

        res.status(200).json({
            success: true,
            message: "Batch fetched successfully",
            batches,
        });

    } catch (error) {
        console.error("Get Batch Error:", error);
        res.status(500).json({
            message: "Server error fetching batch",
            error: error.message,
        });
    }
};

// DELETE BATCH
// ---------------------------------------------
module.exports.deleteBatch = async (req, res) => {
    try {
        const { id } = req.params;

        const deleted = await batchColl
            .deleteOne({ _id: new ObjectId(id) });

        if (deleted.deletedCount === 0) {
            return res.status(404).json({ message: "Batch not found" });
        }

        res.status(200).json({
            message: "Batch deleted successfully",
        });

    } catch (error) {
        console.error("Delete Batch Error:", error);
        res.status(500).json({
            message: "Server error deleting batch",
            error: error.message,
        });
    }
};


/**
 * STAGE 1: Buy mature birds from farmer and stock into inventory
 */
module.exports.buyBirdsFromFarmer = async (req, res) => {
  const session = client.startSession();

  try {
    const { batchId } = req.params;
    const {
      birdCount,
      totalWeightKg,
      purchaseRatePerKg,
      productId, // Product ID for "Live Broiler Chicken"
      productName = "Live Broiler Chicken",
      harvestDate,
      offsetFarmerDue = true,
      paidAmount = 0,
      paymentAccountId = null,
      paymentMethod = "cash",
      notes
    } = req.body;

    const count = Number(birdCount);
    const weight = Number(totalWeightKg);
    const rate = Number(purchaseRatePerKg);
    const paid = Number(paidAmount || 0);

    if (!batchId || !ObjectId.isValid(batchId)) {
      return res.status(400).json({ success: false, message: "Valid Batch ID is required." });
    }
    if (!productId || !ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: "Live bird product selection is required." });
    }
    if (count <= 0 || weight <= 0 || rate <= 0) {
      return res.status(400).json({ success: false, message: "Bird count, weight, and rate must be greater than zero." });
    }

    const totalCost = Number((weight * rate).toFixed(2));
    const memoNo = `PUR-BIRD-${Date.now().toString().slice(-6)}`;
    const dateObj = harvestDate ? new Date(harvestDate) : new Date();

    await session.startTransaction();

    // 1. Fetch batch
    const batch = await batchColl.findOne({ _id: new ObjectId(batchId) }, { session });
    if (!batch) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Batch not found." });
    }

    if (batch.status === "HARVESTED" || batch.status === "COMPLETED") {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: "Batch has already been harvested." });
    }

    // 2. Create Purchase Record (Supplier = Farmer)
    const purchaseDoc = {
      memoNo,
      date: dateObj,
      supplier_id: batch.farmerId ? new ObjectId(batch.farmerId) : null,
      supplier_name: batch.farmer,
      batch_id: batch._id,
      products: [
        {
          product_id: new ObjectId(productId),
          name: productName,
          qty: weight, // Qty stored as KG in inventory
          bird_count: count,
          purchase_price: rate,
          subtotal: totalCost
        }
      ],
      total_amount: totalCost,
      paid_amount: paid,
      payment_method: paid > 0 ? paymentMethod : "due",
      account_id: paid > 0 && paymentAccountId ? new ObjectId(paymentAccountId) : null,
      type: "BATCH_BUYBACK",
      notes: notes || `Stage 1 Buyback from batch ${batch._id}`,
      createdAt: new Date()
    };
    const purchaseResult = await purchasesCol.insertOne(purchaseDoc, { session });

    // 3. Stock-In to Inventory (Weighted Average Cost Update)
    const existingInventory = await inventoryCol.findOne({ product_id: new ObjectId(productId) }, { session });
    if (existingInventory) {
      const currentStock = Math.max(0, Number(existingInventory.stock_qty || 0));
      const currentAvg = Number(existingInventory.average_purchase_price || rate);
      const newAvg = currentStock === 0
        ? rate
        : ((currentStock * currentAvg) + (weight * rate)) / (currentStock + weight);

      await inventoryCol.updateOne(
        { product_id: new ObjectId(productId) },
        {
          $inc: { stock_qty: weight },$set: {
            average_purchase_price: Number(newAvg.toFixed(4)),
            last_purchase_price: rate,
            last_updated: new Date()
          }
        },
        { session }
      );
    } else {
      await inventoryCol.insertOne({
        product_id: new ObjectId(productId),
        item_name: productName,
        stock_qty: weight,
        average_purchase_price: rate,
        last_purchase_price: rate,
        last_updated: new Date()
      }, { session });
    }

    // 4. Update Financial Balances
    // (A) Cash Paid Outflow
    if (paid > 0 && paymentAccountId) {
      await updateAccountBalance({
        client,
        db,
        amount: paid,
        transactionType: "debit", // Money leaving register
        entrySource: "bird_buyback_payment",
        accountId: paymentAccountId.toString(),
        details: { purchaseId: purchaseResult.insertedId, batchId: batch._id },
        session
      });
    }

    // (B) Reconcile Farmer's Due Balance
    if (batch.farmerId) {
      const farmerObjId = new ObjectId(batch.farmerId);
      const netPayableCredited = totalCost - paid;

      if (offsetFarmerDue && netPayableCredited > 0) {
        // Payout to farmer offsets their feed/chick debt
        await customersCol.updateOne(
          { _id: farmerObjId },
          {
            $inc: { due: -netPayableCredited },$set: { last_payment_date: new Date() }
          },
          { session }
        );
      }
    }

    // 5. Update Batch Status to HARVESTED
    await batchColl.updateOne(
      { _id: batch._id },
      {
        $set: {
          status: "HARVESTED",
          active: false, // Shed is now cleared of live flock
          harvestDetails: {
            harvestDate: dateObj,
            birdCount: count,
            totalWeightKg: weight,
            purchaseRatePerKg: rate,
            totalPurchaseCost: totalCost,
            purchaseMemoId: purchaseResult.insertedId,
            productId: new ObjectId(productId),
            productName,
            isFullyDistributed: false
          },
          updatedAt: new Date()
        }
      },
      { session }
    );

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: "Birds successfully harvested and added to inventory.",
      purchaseMemoId: purchaseResult.insertedId,
      totalCost
    });

  } catch (error) {
    await session.abortTransaction();
    console.error("buyBirdsFromFarmer error:", error);
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    await session.endSession();
  }
};


/**
 * Summary of Harvested Stock vs. Dealer Sales
 */
module.exports.getBatchHarvestSummary = async (req, res) => {
  try {
    const { batchId } = req.params;
    if (!batchId || !ObjectId.isValid(batchId)) {
      return res.status(400).json({ success: false, message: "Valid Batch ID is required." });
    }

    const bId = new ObjectId(batchId);
    const batch = await batchColl.findOne({ _id: bId });
    if (!batch) {
      return res.status(404).json({ success: false, message: "Batch not found." });
    }

    // Support both harvestDetails and harvestSummary field names
    const harvestInfo = batch.harvestDetails || batch.harvestSummary;

    if (!harvestInfo) {
      return res.status(200).json({
        success: true,
        harvested: false,
        message: "This batch has not entered Stage 1 Harvest."
      });
    }

    // Fetch all sales invoices linked to this batch
    const sales = await salesColl.find({
      $or: [{ batch_id: bId }, { batch_id: batchId }]
    }).toArray();

    const targetProductIdStr = harvestInfo.productId?.toString();

    let totalWeightSold = 0;
    let totalBirdsSold = 0;
    let totalRevenueFromBirds = 0;
    const dealerDistributionList = [];

    sales.forEach((s) => {
      (s.products || []).forEach((p) => {
        const pIdStr = p.product_id?.toString() || p._id?.toString();
        const isLiveBird =
          !targetProductIdStr ||
          pIdStr === targetProductIdStr ||
          p.name?.toLowerCase().includes("chicken") ||
          p.name?.toLowerCase().includes("broiler");

        if (isLiveBird) {
          const soldWeight = Number(p.qty || 0);
          const birdNum = Number(p.bird_count || 0);
          const revenue = Number(p.subtotal || (soldWeight * (p.sale_price || 0)));

          totalWeightSold += soldWeight;
          totalBirdsSold += birdNum;
          totalRevenueFromBirds += revenue;

          dealerDistributionList.push({
            saleId: s._id,
            memoNo: s.memoNo,
            date: s.date,
            customer_id: s.customer_id,
            weightKg: soldWeight,
            birdCount: birdNum,
            ratePerKg: p.sale_price,
            subtotal: revenue
          });
        }
      });
    });

    const initialWeight = Number(harvestInfo.totalWeightKg || 0);
    const initialCost = Number(harvestInfo.totalPurchaseCost || 0);
    const remainingWeight = Math.max(0, initialWeight - totalWeightSold);
    const costOfGoodsSold = Number((totalWeightSold * (harvestInfo.purchaseRatePerKg || 0)).toFixed(2));
    const profitSoFar = Number((totalRevenueFromBirds - costOfGoodsSold).toFixed(2));

    return res.status(200).json({
      success: true,
      harvested: true,
      data: {
        harvestDetails: harvestInfo,
        totalWeightHarvested: initialWeight,
        totalBirdsHarvested: harvestInfo.birdCount || 0,
        totalPurchaseCost: initialCost,
        totalWeightSold,
        totalBirdsSold,
        remainingWeight,
        percentSold: initialWeight > 0 ? Math.min(100, +((totalWeightSold / initialWeight) * 100).toFixed(1)) : 0,
        totalRevenue: totalRevenueFromBirds,
        grossProfit: profitSoFar,
        isCompleted: remainingWeight <= 0 && initialWeight > 0,
        distributionMemos: dealerDistributionList
      }
    });
  } catch (error) {
    console.error("getBatchHarvestSummary error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};