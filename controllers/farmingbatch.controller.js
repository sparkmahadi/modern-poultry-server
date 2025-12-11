
const { ObjectId } = require("mongodb");
const { db } = require("../db");
const batchColl = db.collection("batches");
const salesColl = db.collection("sales");


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
        const batchId = req.params.batchId;

        if (!batchId) {
            return res.status(400).json({
                success: false,
                message: "Batch ID is required",
            });
        }

        // 1. Fetch the batch
        const batch = await batchColl.findOne({ _id: new ObjectId(batchId) });

        if (!batch) {
            return res.status(404).json({
                success: false,
                message: "Batch not found",
            });
        }

        // 2. If empty or missing
        if (!batch.salesHistoryIds || batch.salesHistoryIds.length === 0) {
            return res.status(200).json({
                success: true,
                message: "No sales found for this batch",
                sales: [],
            });
        }

        // Convert raw ObjectIds into actual ObjectId list
        const saleIds = batch.salesHistoryIds.map(id => new ObjectId(id));

        // 3. Fetch sales documents linked to this batch
        const sales = await salesColl
            .find({ _id: { $in: saleIds } })
            .sort({ date: -1 })
            .toArray();

        return res.status(200).json({
            success: true,
            message: "Sales fetched successfully",
            sales,
        });

    } catch (error) {
        console.error("Get Batch Sales Error:", error);
        return res.status(500).json({
            success: false,
            message: "Server error while fetching batch sales",
            error: error.message,
        });
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
