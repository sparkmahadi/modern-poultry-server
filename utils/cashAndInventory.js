
const { ObjectId } = require("mongodb");
const {db} = require("../db");

// ----- Inventory -----
const inventoryCollection = db.collection("inventory");
const cashCol = db.collection("cash");
const transactionsCol = db.collection("transactions");

// 🟢 Add purchased products to inventory
async function addToInventory(product, invoiceId) {
  console.log("🟢 [addToInventory] Called with:", {
    product_id: product?.product_id,
    name: product?.name,
    qty: product?.qty,
    invoiceId
  });

  try {
    // 🔸 Validate product data
    if (!product || !product.product_id || !product.qty || !product.purchase_price) {
      console.error("❌ [addToInventory] Invalid product data:", product);
      return { success: false, message: `Invalid product data for: ${product?.name || "Unnamed product"}` };
    }

    // 🔸 Find existing inventory item
    const existingItem = await inventoryCollection.findOne({
      product_id: new ObjectId(product.product_id)
    });

    const purchaseRecord = {
      invoice_id: invoiceId.toString(),
      qty: product.qty,
      purchase_price: product.purchase_price,
      subtotal: product.subtotal,
      date: new Date()
    };

    if (existingItem) {
      console.log(`🟡 [addToInventory] Updating existing item: ${product.name}`);

      // Calculate weighted average purchase price
      const oldQty = existingItem.total_stock_qty || 0;
      const oldAvg = existingItem.average_purchase_price || product.purchase_price;
      const newAvg =
        (oldAvg * oldQty + product.purchase_price * product.qty) /
        (oldQty + product.qty);

      // 🔹 Update existing product
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

      console.log(`✅ [addToInventory] Updated inventory for ${product.name}`);
      return { success: true, message: `Inventory updated for ${product.name}` };
    } else {
      console.log(`🟢 [addToInventory] Adding new inventory item: ${product.name}`);

      // 🔹 Insert new product
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

      console.log(`✅ [addToInventory] New item added: ${product.name}`);
      return { success: true, message: `New inventory item added: ${product.name}` };
    }
  } catch (error) {
    console.error("❌ [addToInventory ERROR]:", error.message);
    return { success: false, message: `Failed to update inventory for ${product?.name || "unknown item"}: ${error.message}` };
  }
}



// 🔴 Deduct sold or old purchased products from inventory
async function deductFromInventory(product, memoId) {
  try {
    // ✅ Fallback to _id for backward compatibility
    const productId = product.product_id || product._id;

    if (!productId || !product.qty) {
      console.error("❌ [deductFromInventory] Invalid product data:", product);
      return { success: false, message: `Invalid product data for inventory deduction (${product?.name || "Unknown"})` };
    }

    console.log("🟡 [deductFromInventory] Processing:", {
      product_id: productId,
      name: product.name,
      qty: product.qty,
      memoId
    });

    const existingItem = await inventoryCollection.findOne({ product_id: new ObjectId(productId) });

    if (!existingItem) {
      console.warn(`⚠️ [deductFromInventory] Product not found in inventory: ${product.name}`);
      return { success: false, message: `Product not found in inventory: ${product.name}` };
    }

    const saleRecord = {
      memo_id: memoId.toString(),
      qty: product.qty,
      price: product.price || product.purchase_price || 0,
      subtotal: product.subtotal || 0,
      date: new Date()
    };

    const result = await inventoryCollection.updateOne(
      { product_id: new ObjectId(productId) },
      {
        $inc: { total_stock_qty: -product.qty },
        $set: { last_updated: new Date() },
        $push: { sale_history: saleRecord }
      }
    );

    if (result.modifiedCount > 0) {
      console.log(`✅ [deductFromInventory] Deducted ${product.qty} from ${product.name}`);
      return { success: true, message: `Inventory updated for ${product.name}` };
    } else {
      console.warn(`⚠️ [deductFromInventory] No change for ${product.name}`);
      return { success: false, message: `No update occurred for ${product.name}` };
    }
  } catch (err) {
    console.error("❌ [deductFromInventory ERROR]:", err);
    return { success: false, message: err.message };
  }
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
/**
 * Increase cash balance and log transaction
 * @param {Number} amount - amount to add
 * @param {String} entrySource - e.g., "sale_memo" or "invoice"
 * @param {Object} details - additional details like products, invoice/memo id
 * @returns {Object} { success: boolean, newBalance, message }
 */
async function increaseCash(amount, entrySource, details = {}) {
  try {
    const cashAccount = await cashCol.findOne({});
    const lastBalance = cashAccount?.current_balance || 0;
    const newBalance = lastBalance + amount;

    // Log transaction
    await transactionsCol.insertOne({
      date: new Date(),
      time: new Date().toTimeString().split(" ")[0],
      entry_source: entrySource,
      transaction_type: "credit",
      amount,
      balance_after_transaction: newBalance,
      payment_details: details.paymentDetails || {},
      products: details.products || [],
      invoice_id: details.invoiceId || details.memoId || null,
      created_by: details.createdBy || "admin",
      remarks: details.remarks || ""
    });

    // Update cash balance
    await cashCol.updateOne({}, { $set: { current_balance: newBalance } }, { upsert: true });

    return { success: true, newBalance, message: "Cash increased successfully" };
  } catch (err) {
    console.error("❌ [increaseCash ERROR]:", err);
    return { success: false, message: err.message };
  }
}

/**
 * Decrease cash balance and log transaction
 * @param {Number} amount - amount to deduct
 * @param {String} entrySource - e.g., "invoice"
 * @param {Object} details - additional details like products, invoice id
 * @returns {Object} { success: boolean, newBalance, message }
 */
async function decreaseCash(amount, entrySource, details = {}) {
  try {
    const cashAccount = await cashCol.findOne({});
    const lastBalance = cashAccount?.current_balance || 0;
    const newBalance = lastBalance - amount;

    // Log transaction
    await transactionsCol.insertOne({
      date: new Date(),
      time: new Date().toTimeString().split(" ")[0],
      entry_source: entrySource,
      transaction_type: "debit",
      amount,
      balance_after_transaction: newBalance,
      payment_details: details.paymentDetails || {},
      products: details.products || [],
      invoice_id: details.invoiceId || details.memoId || null,
      created_by: details.createdBy || "admin",
      remarks: details.remarks || ""
    });

    // Update cash balance
    await cashCol.updateOne({}, { $set: { current_balance: newBalance } }, { upsert: true });

    return { success: true, newBalance, message: "Cash decreased successfully" };
  } catch (err) {
    console.error("❌ [decreaseCash ERROR]:", err);
    return { success: false, message: err.message };
  }
}

module.exports = {
  addToInventory,
  subtractFromInventory,
  deductFromInventory,
  increaseCash,
  decreaseCash
};
