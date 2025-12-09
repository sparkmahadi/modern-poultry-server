
const { ObjectId } = require("mongodb");
const {db} = require("../db");
const batchColl = db.collection("batches");


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
        const payload = req.body;

        if (!batchId) {
            return res.status(400).json({ message: "Batch ID is required" });
        }

        const { ObjectId } = req.db;

        const updated = await batchColl
            .findOneAndUpdate(
                { _id: new ObjectId(batchId) },
                { $set: payload },
                { returnDocument: "after" }
            );

        if (!updated.value) {
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



// GET SINGLE BATCH BY ID
// ---------------------------------------------
module.exports.getBatchById = async (req, res) => {
    try {
        const { id } = req.params;
        const { ObjectId } = req.db;

        const batch = await batchColl
            .findOne({ _id: new ObjectId(id) });

        if (!batch) {
            return res.status(404).json({ message: "Batch not found" });
        }

        res.status(200).json({
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
