const { ObjectId } = require("mongodb");
const { db } = require("../db");
const suppliersCollection = db.collection("suppliers");

// 📦 Get all suppliers
exports.getSuppliers = async (req, res) => {
    try {
        const suppliers = await suppliersCollection.find().sort({ name: 1 }).toArray();
        res.status(200).json({ success: true, data: suppliers });
    } catch (error) {
        console.error("Error fetching suppliers:", error);
        res.status(500).json({ success: false, message: "Failed to fetch suppliers", error: error.message });
    }
};

exports.getSupplierById = async (req, res) => {
    console.log('hit getSupplierById');
    try {
        const { id } = req.params;

        if (id) {
            // Get a single Supplier
            const supplier = await suppliersCollection.findOne({ _id: new ObjectId(id) });
            console.log(supplier);
            if (!supplier) {
                return res.status(404).json({ success: false, message: 'Supplier not found' });
            }
            res.status(200).json({ success: true, data: (supplier) });
        }
    } catch (error) {
        console.error('Error fetching Supplier(s):', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// 📦 Search suppliers
exports.searchSuppliers = async (req, res) => {
    try {
        const { q } = req.query;

        if (!q || q.trim() === "") {
            return res.status(400).json({ success: false, message: "Search query required" });
        }

        const regex = new RegExp(q.trim(), "i"); // case-insensitive search

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

        res.status(200).json({ success: true, data: suppliers });
    } catch (error) {
        console.error("Error searching suppliers:", error);
        res.status(500).json({ success: false, message: "Failed to search suppliers", error: error.message });
    }
};

// ➕ Create a new supplier
exports.createSupplier = async (req, res) => {
    const { name, address, phone, type, manual_due, manual_advance, due, advance, status } = req.body;

    if (!name || !type) {
        return res.status(400).json({ success: false, message: "Supplier name and type are required." });
    }

    try {
        const newSupplier = {
            name,
            address: address || "",
            phone: phone || "",
            type: type || "regular",
            manual_due: Number(manual_due) || 0,
            manual_advance: Number(manual_advance) || 0,
            due: Number(due) || 0,
            advance: Number(advance) || 0,
            status: status || "active",
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const result = await suppliersCollection.insertOne(newSupplier);
        res.status(201).json({ success: true, message: "Supplier added successfully", data: { _id: result.insertedId, ...newSupplier } });
    } catch (error) {
        console.error("Error creating supplier:", error);
        res.status(500).json({ success: false, message: "Failed to create supplier", error: error.message });
    }
};

// ✏️ Update supplier
exports.updateSupplier = async (req, res) => {
    const { id } = req.params;
    const { name, address, phone, type, manual_due, manual_advance, due, advance, status } = req.body;
    console.log('updateSupplier', req.body);
    // return res.status(200).json({ success: true, message: "Supplier updated successfully",});
    try {
        const supplier = await suppliersCollection.findOne({ _id: new ObjectId(id) });
        if (!supplier) {
            return res.status(404).json({ success: false, message: "Supplier not found" });
        }

        const updatedSupplier = {
            name: name ?? supplier.name,
            address: address ?? supplier.address,
            phone: phone ?? supplier.phone,
            type: type ?? supplier.type,
            manual_due: Number(manual_due) || 0,
            manual_advance: Number(manual_advance) || 0,
            due: due !== undefined ? Number(due) : supplier.due,
            advance: advance !== undefined ? Number(advance) : supplier.advance,
            status: status ?? supplier.status,
            updatedAt: new Date(),
        };

        await suppliersCollection.updateOne({ _id: new ObjectId(id) }, { $set: updatedSupplier });

        res.status(200).json({ success: true, message: "Supplier updated successfully", data: { _id: id, ...updatedSupplier } });
    } catch (error) {
        console.error("Error updating supplier:", error);
        res.status(500).json({ success: false, message: "Failed to update supplier", error: error.message });
    }
};

// ❌ Delete supplier
exports.deleteSupplier = async (req, res) => {
    const { id } = req.params;

    try {
        const result = await suppliersCollection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, message: "Supplier not found" });
        }

        res.status(200).json({ success: true, message: "Supplier deleted successfully" });
    } catch (error) {
        console.error("Error deleting supplier:", error);
        res.status(500).json({ success: false, message: "Failed to delete supplier", error: error.message });
    }
};
