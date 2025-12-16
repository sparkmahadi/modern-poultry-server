const { ObjectId } = require("mongodb");
const { db } = require("../db");

// Create a new customer
exports.createCustomer = async (req, res) => {
  console.log('hit create customer');
  const { name, address, phone, type, manual_due, manual_advance, due, advance, status } = req.body;
  console.log(req.body)

  if (!name || !type) {
    return res.status(400).json({ success: false, message: "Name and type are required." });
  }

  try {
    const result = await db.collection("customers").insertOne({
      name,
      address: address || "",
      phone: phone || "",
      type,
      manual_due: manual_due || 0,
      manual_advance: manual_advance || 0,
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

// Get all customers
exports.getCustomerById = async (req, res) => {
  const id = req.params.id;
  try {
    const customer = await db.collection("customers").findOne({ _id: new ObjectId(id) });
    console.log("getCustomerById",id, 'found', customer);
    res.status(200).json({ success: true, data: customer });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


exports.searchCustomers = async (req, res) => {
  console.log("hit search customers");
  const searchTerm = req.query.q?.trim();

  if (!searchTerm || searchTerm === "") {
    return res.status(400).json({ success: false, message: "Search term is required." });
  }

  try {
    const regex = new RegExp(searchTerm, "i");
    const results = await db
      .collection("customers")
      .find({
        $or: [
          { name: { $regex: regex } },
          { phone: { $regex: regex } },
        ],
      })
      .limit(10)
      .toArray();

    res.status(200).json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// Update a customer
exports.updateCustomer = async (req, res) => {
  const { id } = req.params;
  const { _id, ...updateData } = req.body;
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



// 1️⃣ Get customer by ID
async function getCustomer(customerId) {
  const customer = await db.collection("customers").findOne({ _id: new ObjectId(customerId) });
  if (!customer) throw new Error("Customer not found");
  return customer;
}

// 2️⃣ Create customer if not exists
async function createCustomerIfNotExists({ name, customer_type = "temporary" }) {

  // Check if customer already exists
  let customer = await db.collection("customers").findOne({ name });
  if (customer) return customer;

  // Create new customer
  const newCustomer = {
    _id: new ObjectId(),
    name,
    customer_type,
    balance: 0,       // can be updated for partial payments
    createdAt: new Date()
  };

  await db.collection("customers").insertOne(newCustomer);
  return newCustomer;
}

// 3️⃣ Update customer balance
async function updateCustomerBalance(customerId, amount) {

  const customer = await db.collection("customers").findOne({ _id: new ObjectId(customerId) });
  if (!customer) throw new Error("Customer not found");

  const newBalance = (customer.balance || 0) + amount;

  await db.collection("customers").updateOne(
    { _id: new ObjectId(customerId) },
    { $set: { balance: newBalance } }
  );

  return newBalance;
}
