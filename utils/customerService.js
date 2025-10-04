const { ObjectId } = require("mongodb");
const {db} = require("../db.js");

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

module.exports = {
  getCustomer,
  createCustomerIfNotExists,
  updateCustomerBalance
};
