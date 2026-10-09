const { ObjectId } = require("mongodb");
const { db } = require("../db");
const customersCol = db.collection("customers");

// Helper: Escape regex characters
const escapeRegex = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

// ➕ Create a new customer
exports.createCustomer = async (req, res) => {
  const { name, address, phone, type, manual_due, manual_advance, due, advance, status } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: "Customer name is required." });
  }

  try {
    const newCustomer = {
      name: name.trim(),
      address: address ? address.trim() : "",
      phone: phone ? phone.trim() : "",
      type: type || "permanent",
      manual_due: Number(manual_due) || 0,
      manual_advance: Number(manual_advance) || 0,
      due: Number(due) || 0,
      advance: Number(advance) || 0,
      total_sales: 0,
      total_due: Number(due) || 0,
      status: status || "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await customersCol.insertOne(newCustomer);
    return res.status(201).json({
      success: true,
      message: "Customer created successfully",
      data: { _id: result.insertedId, ...newCustomer },
    });
  } catch (err) {
    console.error("createCustomer error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// 📦 Get all customers (with optional search and sorting)
exports.getCustomers = async (req, res) => {
  try {
    const { q } = req.query;
    let query = {};

    if (q && q.trim()) {
      const regex = new RegExp(escapeRegex(q.trim()), "i");
      query = {
        $or: [
          { name: { $regex: regex } },
          { phone: { $regex: regex } },
          { address: { $regex: regex } },
          { type: { $regex: regex } },
        ],
      };
    }

    const customers = await customersCol.find(query).sort({ createdAt: -1 }).toArray();
    return res.status(200).json({ success: true, count: customers.length, data: customers });
  } catch (err) {
    console.error("getCustomers error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// 🔍 Get customer by ID
exports.getCustomerById = async (req, res) => {
  const { id } = req.params;

  if (!id || !ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: "Valid customer ID is required" });
  }

  try {
    const customer = await customersCol.findOne({ _id: new ObjectId(id) });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }
    return res.status(200).json({ success: true, data: customer });
  } catch (err) {
    console.error("getCustomerById error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// 🔎 Search customers autocomplete (Debounced endpoint)
exports.searchCustomers = async (req, res) => {
  const searchTerm = req.query.q?.trim();

  if (!searchTerm || searchTerm === "") {
    return res.status(400).json({ success: false, message: "Search query is required." });
  }

  try {
    const regex = new RegExp(escapeRegex(searchTerm), "i");
    const results = await customersCol
      .find({
        $or: [
          { name: { $regex: regex } },
          { phone: { $regex: regex } },
          { address: { $regex: regex } },
          { type: { $regex: regex } },
        ],
      })
      .limit(15)
      .toArray();

    return res.status(200).json({ success: true, count: results.length, data: results });
  } catch (err) {
    console.error("searchCustomers error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ✏️ Update customer details
exports.updateCustomer = async (req, res) => {
  const { id } = req.params;

  if (!id || !ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: "Valid customer ID is required" });
  }

  const { _id, ...updateData } = req.body;

  try {
    const existing = await customersCol.findOne({ _id: new ObjectId(id) });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Customer not found." });
    }

    const payload = {
      name: updateData.name !== undefined ? updateData.name.trim() : existing.name,
      address: updateData.address !== undefined ? updateData.address.trim() : existing.address,
      phone: updateData.phone !== undefined ? updateData.phone.trim() : existing.phone,
      type: updateData.type || existing.type,
      manual_due: updateData.manual_due !== undefined ? (Number(updateData.manual_due) || 0) : (existing.manual_due || 0),
      manual_advance: updateData.manual_advance !== undefined ? (Number(updateData.manual_advance) || 0) : (existing.manual_advance || 0),
      due: updateData.due !== undefined ? (Number(updateData.due) || 0) : (existing.due || 0),
      advance: updateData.advance !== undefined ? (Number(updateData.advance) || 0) : (existing.advance || 0),
      status: updateData.status || existing.status,
      updatedAt: new Date(),
    };

    await customersCol.updateOne({ _id: new ObjectId(id) }, { $set: payload });
    const updated = await customersCol.findOne({ _id: new ObjectId(id) });

    return res.status(200).json({ success: true, message: "Customer updated successfully", data: updated });
  } catch (err) {
    console.error("updateCustomer error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ❌ Delete customer
exports.deleteCustomer = async (req, res) => {
  const { id } = req.params;

  if (!id || !ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: "Valid customer ID is required" });
  }

  try {
    const result = await customersCol.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: "Customer not found." });
    }
    return res.status(200).json({ success: true, message: "Customer deleted successfully." });
  } catch (err) {
    console.error("deleteCustomer error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};