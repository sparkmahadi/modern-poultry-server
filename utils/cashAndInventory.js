
const { ObjectId } = require("mongodb");
const {db} = require("../db");

// ----- Inventory -----
async function addToInventory(productId, qty, reason, ref) {
  const product = await db.collection("inventory").findOne({ _id: new ObjectId(productId) });

  if (!product) throw new Error("Product not found");

  const newQty = (product.stock_qty || 0) + qty;

  await db.collection("inventory").updateOne(
    { _id: new ObjectId(productId) },
    { $set: { stock_qty: newQty } }
  );

  await db.collection("inventory_log").insertOne({
    productId: new ObjectId(productId),
    change: qty,
    reason,
    ref,
    type: "add",
    date: new Date(),
    resultingStock: newQty
  });

  return newQty;
}

async function subtractFromInventory(productId, qty, reason, ref) {
  const product = await db.collection("inventory").findOne({ _id: new ObjectId(productId) });

  if (!product) throw new Error("Product not found");
  if ((product.stock_qty || 0) < qty) throw new Error("Insufficient stock");

  const newQty = product.stock_qty - qty;

  await db.collection("inventory").updateOne(
    { _id: new ObjectId(productId) },
    { $set: { stock_qty: newQty } }
  );

  await db.collection("inventory_log").insertOne({
    productId: new ObjectId(productId),
    change: -qty,
    reason,
    ref,
    type: "subtract",
    date: new Date(),
    resultingStock: newQty
  });

  return newQty;
}

// ----- Cash -----
async function increaseCash(amount, refType, refId) {
  const cashDoc = await db.collection("cash").findOne({ _id: "main" });

  const prevAmount = cashDoc?.balance || 0;
  const newAmount = prevAmount + amount;

  await db.collection("cash").updateOne(
    { _id: "main" },
    { $set: { balance: newAmount } },
    { upsert: true }
  );

  await db.collection("cash_log").insertOne({
    change: amount,
    type: "credit",
    refType,
    refId,
    date: new Date(),
    resultingBalance: newAmount
  });

  return newAmount;
}

async function decreaseCash(amount, refType, refId) {
  const cashDoc = await db.collection("cash").findOne({ _id: "main" });

  const prevAmount = cashDoc?.balance || 0;
  if (prevAmount < amount) throw new Error("Insufficient cash");

  const newAmount = prevAmount - amount;

  await db.collection("cash").updateOne(
    { _id: "main" },
    { $set: { balance: newAmount } }
  );

  await db.collection("cash_log").insertOne({
    change: -amount,
    type: "debit",
    refType,
    refId,
    date: new Date(),
    resultingBalance: newAmount
  });

  return newAmount;
}

module.exports = {
  addToInventory,
  subtractFromInventory,
  increaseCash,
  decreaseCash
};
