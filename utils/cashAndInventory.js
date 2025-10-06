
const { ObjectId } = require("mongodb");
const {db} = require("../db");

// ----- Inventory -----
const inventoryCollection = db.collection("inventory");

// 🟢 Add purchased products to inventory
async function addToInventory(product, invoiceId) {
  console.log("received data at addToInventory", "product, invoiceId,", product, invoiceId);

  const existingItem = await inventoryCollection.findOne({
   product_id: (product.product_id)
  });

  const purchaseRecord = {
    invoice_id: invoiceId.toString(),
    qty: product.qty,
    purchase_price: product.purchase_price,
    subtotal: product.subtotal,
    date: new Date()
  };

  if (existingItem) {
    // Calculate average price (optional)
    const oldQty = existingItem.total_stock_qty || 0;
    const oldAvg = existingItem.average_purchase_price || product.purchase_price;
    const newAvg =
      (oldAvg * oldQty + product.purchase_price * product.qty) /
      (oldQty + product.qty);

    // Update existing product
    await inventoryCollection.updateOne(
      { product_id: new ObjectId(product.product_id) },
      {
        $inc: { total_stock_qty: product.qty },
        $set: {
          last_purchase_price: product.purchase_price,
          average_purchase_price: newAvg,
          last_updated: new Date()
        },
        $push: { purchase_history: purchaseRecord }
      }
    );
  } else {
    // Insert as new product
    await inventoryCollection.insertOne({
      product_id: new ObjectId(product.product_id),
      item_name: product.name,
      total_stock_qty: product.qty,
      sale_price: null,
      last_purchase_price: product.purchase_price,
      average_purchase_price: product.purchase_price,
      reorder_level: 0,
      last_updated: new Date(),
      purchase_history: [purchaseRecord],
      sale_history: []
    });
  }
}


// 🔴 Deduct sold products from inventory
async function deductFromInventory(product, memoId) {

  const existingItem = await inventoryCollection.findOne({
    product_id: new ObjectId(product._id)
  });

  if (!existingItem) {
    return res.json({success: false, message: `Product not found in inventory: ${product.item_name}`});
  }

  if ((existingItem.total_stock_qty || 0) < product.qty) {
    throw new Error(`Insufficient stock for product: ${product.item_name}`);
  }

  const saleRecord = {
    memo_id: memoId.toString(),
    qty: product.qty,
    price: product.price,
    subtotal: product.subtotal,
    date: new Date()
  };

  // Deduct from total stock and log sale
  await inventoryCollection.updateOne(
    { product_id: new ObjectId(product._id) },
    {
      $inc: { total_stock_qty: -product.qty },
      $set: { last_updated: new Date() },
      $push: { sale_history: saleRecord }
    }
  );
}

// 🧠 How to Use in Controllers
// 📦 Purchase Controller
// for (const product of products) {
//   await addToInventory(db, product, invoiceId);
// }

// for (const product of products) {
//   await deductFromInventory(db, product, memoId);
// }


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
  deductFromInventory,
  increaseCash,
  decreaseCash
};
