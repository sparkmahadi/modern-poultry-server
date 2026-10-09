const { ObjectId } = require("mongodb");
const { db } = require("../db");
const suppliersCollection = db.collection("suppliers");

// Helper: Escape regex special characters
const escapeRegex = (string) => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

// 📦 Get all suppliers (with optional search & pagination)
exports.getSuppliers = async (req, res) => {
    try {
        const { q, page, limit } = req.query;
        let filter = {};

        if (q && q.trim()) {
            const regex = new RegExp(escapeRegex(q.trim()), "i");
            filter = {
                $or: [
                    { name: regex },
                    { phone: regex },
                    { type: regex },
                    { address: regex },
                ],
            };
        }

        if (page && limit) {
            const pageNum = Math.max(1, parseInt(page, 10) || 1);
            const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
            const skip = (pageNum - 1) * limitNum;

            const [suppliers, total] = await Promise.all([
                suppliersCollection.find(filter).sort({ name: 1 }).skip(skip).limit(limitNum).toArray(),
                suppliersCollection.countDocuments(filter)
            ]);

            return res.status(200).json({
                success: true,
                count: suppliers.length,
                data: suppliers,
                pagination: {
                    total,
                    page: pageNum,
                    limit: limitNum,
                    totalPages: Math.ceil(total / limitNum)
                }
            });
        }

        const suppliers = await suppliersCollection.find(filter).sort({ name: 1 }).toArray();
        return res.status(200).json({ success: true, count: suppliers.length, data: suppliers });
    } catch (error) {
        console.error("Error fetching suppliers:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch suppliers", error: error.message });
    }
};

// 🔍 Get single supplier by ID
exports.getSupplierById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id || !ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Valid supplier ID is required" });
        }

        const supplier = await suppliersCollection.findOne({ _id: new ObjectId(id) });
        if (!supplier) {
            return res.status(404).json({ success: false, message: "Supplier not found" });
        }

        return res.status(200).json({ success: true, data: supplier });
    } catch (error) {
        console.error("Error fetching supplier:", error);
        return res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

// 🔎 Search suppliers endpoint
exports.searchSuppliers = async (req, res) => {
    try {
        const { q } = req.query;

        if (!q || q.trim() === "") {
            return res.status(400).json({ success: false, message: "Search query required" });
        }

        const regex = new RegExp(escapeRegex(q.trim()), "i");

        const suppliers = await suppliersCollection
            .find({
                $or: [
                    { name: regex },
                    { phone: regex },
                    { type: regex },
                    { address: regex },
                ],
            })
            .sort({ name: 1 })
            .toArray();

        return res.status(200).json({ success: true, count: suppliers.length, data: suppliers });
    } catch (error) {
        console.error("Error searching suppliers:", error);
        return res.status(500).json({ success: false, message: "Failed to search suppliers", error: error.message });
    }
};

// ➕ Create a new supplier
exports.createSupplier = async (req, res) => {
    const { name, address, phone, type, manual_due, manual_advance, due, advance, status } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ success: false, message: "Supplier name is required." });
    }

    try {
        const newSupplier = {
            name: name.trim(),
            address: address ? address.trim() : "",
            phone: phone ? phone.trim() : "",
            type: type || "regular",
            manual_due: Number(manual_due) || 0,
            manual_advance: Number(manual_advance) || 0,
            due: Number(due) || 0,
            advance: Number(advance) || 0,
            total_purchase: 0,
            total_due: Number(due) || 0,
            status: status || "active",
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const result = await suppliersCollection.insertOne(newSupplier);
        return res.status(201).json({
            success: true,
            message: "Supplier added successfully",
            data: { _id: result.insertedId, ...newSupplier }
        });
    } catch (error) {
        console.error("Error creating supplier:", error);
        return res.status(500).json({ success: false, message: "Failed to create supplier", error: error.message });
    }
};

// ✏️ Update supplier
exports.updateSupplier = async (req, res) => {
    const { id } = req.params;

    if (!id || !ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Valid supplier ID is required" });
    }

    const { name, address, phone, type, manual_due, manual_advance, due, advance, status } = req.body;

    try {
        const supplier = await suppliersCollection.findOne({ _id: new ObjectId(id) });
        if (!supplier) {
            return res.status(404).json({ success: false, message: "Supplier not found" });
        }

        const updatedSupplier = {
            name: name !== undefined ? name.trim() : supplier.name,
            address: address !== undefined ? address.trim() : supplier.address,
            phone: phone !== undefined ? phone.trim() : supplier.phone,
            type: type !== undefined ? type : supplier.type,
            manual_due: manual_due !== undefined ? (Number(manual_due) || 0) : (supplier.manual_due || 0),
            manual_advance: manual_advance !== undefined ? (Number(manual_advance) || 0) : (supplier.manual_advance || 0),
            due: due !== undefined ? (Number(due) || 0) : (supplier.due || 0),
            advance: advance !== undefined ? (Number(advance) || 0) : (supplier.advance || 0),
            status: status !== undefined ? status : supplier.status,
            updatedAt: new Date(),
        };

        await suppliersCollection.updateOne({ _id: new ObjectId(id) }, { $set: updatedSupplier });

        return res.status(200).json({
            success: true,
            message: "Supplier updated successfully",
            data: { _id: id, ...updatedSupplier }
        });
    } catch (error) {
        console.error("Error updating supplier:", error);
        return res.status(500).json({ success: false, message: "Failed to update supplier", error: error.message });
    }
};

// ❌ Delete supplier
exports.deleteSupplier = async (req, res) => {
    const { id } = req.params;

    if (!id || !ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Valid supplier ID is required" });
    }

    try {
        const result = await suppliersCollection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, message: "Supplier not found" });
        }

        return res.status(200).json({ success: true, message: "Supplier deleted successfully" });
    } catch (error) {
        console.error("Error deleting supplier:", error);
        return res.status(500).json({ success: false, message: "Failed to delete supplier", error: error.message });
    }
};