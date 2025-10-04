const { ObjectId } = require("mongodb");
const { db } = require("../db");

// Create a new customer
exports.createCustomer = async (req, res) => {
  console.log('hit create customer');
  const { name, address, phone, type, due, advance, status } = req.body;

  if (!name || !type) {
    return res.status(400).json({ success: false, message: "Name and type are required." });
  }

  try {
    const result = await db.collection("customers").insertOne({
      name,
      address: address || "",
      phone: phone || "",
      type,
      due: due || 0,
      advance: advance || 0,
      status: status || "active",
      createdAt: new Date(),
    });

    if (result.acknowledged) {
      res.send({ success: true, data: result });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get all customers
exports.getCustomers = async (req, res) => {
  try {
    const customers = await db.collection("customers").find({}).toArray();
    res.status(200).json({ success: true, data: customers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Update a customer
exports.updateCustomer = async (req, res) => {
  const { id } = req.params;
  const {_id, ...updateData} = req.body;
console.log(updateData);
  try {
    const result = await db.collection("customers").updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData },
      { returnDocument: "after" }
    );

    if (!result.modifiedCount) {
      return res.status(404).json({ success: false, message: "Customer not found." });
    }

    res.send({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Delete a customer
exports.deleteCustomer = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await db.collection("customers").deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: "Customer not found." });
    }

    res.status(200).json({ success: true, message: "Customer deleted successfully." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
