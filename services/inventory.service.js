const { ObjectId } = require("mongodb");
const { db } = require("../db");
const { extractProductId } = require("../utils/id.util");

const inventoryCol = db.collection("inventory");

/* --------------------------------------------------
   INCREASE INVENTORY (stock IN)
-------------------------------------------------- */
async function increaseInventoryStock({
  product_id,
  qty
}) {
  console.log("🟢 [InventoryStock] INCREASE START", { product_id, qty });

  try {
    const pid = extractProductId(product_id);

    if (!pid || !qty || qty <= 0) {
      console.error("❌ Invalid input for increase", { product_id, qty });
      return { success: false, message: "Invalid product_id or qty" };
    }

    const result = await inventoryCol.updateOne(
      { product_id: new ObjectId(pid) },
      {
        $inc: { stock_qty: qty },
        $set: { last_updated: new Date() }
      }
    );

    console.log("📦 Increase result:", result);

    if (result.matchedCount === 0) {
      return { success: false, message: "Inventory item not found" };
    }

    return { success: true, message: "Inventory stock increased" };

  } catch (error) {
    console.error("🔥 Increase inventory error", error);
    return { success: false, message: error.message };
  } finally {
    console.log("🟢 [InventoryStock] INCREASE END\n");
  }
}

/* --------------------------------------------------
   DECREASE INVENTORY (stock OUT)
-------------------------------------------------- */
async function decreaseInventoryStock({
  product_id,
  qty
}) {
  console.log("🔴 [InventoryStock] DECREASE START", { product_id, qty });

  try {
    const pid = extractProductId(product_id);

    if (!pid || !qty || qty <= 0) {
      console.error("❌ Invalid input for decrease", { product_id, qty });
      return { success: false, message: "Invalid product_id or qty" };
    }

    // Optional: prevent negative stock
    const inventoryItem = await inventoryCol.findOne({
      product_id: new ObjectId(pid)
    });

    if (!inventoryItem) {
      return { success: false, message: "Inventory item not found" };
    }

    if (inventoryItem.stock_qty < qty) {
      console.error("❌ Insufficient stock", {
        available: inventoryItem.stock_qty,
        requested: qty
      });

      return { success: false, message: "Insufficient stock quantity" };
    }

    const result = await inventoryCol.updateOne(
      { product_id: new ObjectId(pid) },
      {
        $inc: { stock_qty: -qty },
        $set: { last_updated: new Date() }
      }
    );

    console.log("📦 Decrease result:", result);

    return { success: true, message: "Inventory stock decreased" };

  } catch (error) {
    console.error("🔥 Decrease inventory error", error);
    return { success: false, message: error.message };
  } finally {
    console.log("🔴 [InventoryStock] DECREASE END\n");
  }
}


/* ----------------------------------------
   ADD TO INVENTORY (PURCHASE AWARE)
   ✔ Updates avg price
   ✔ Pushes purchase history
   ✔ Creates inventory if missing
---------------------------------------- */
async function addToInventory(product, invoiceId) {
  console.log('received request to addToInventory for product', product, "invoice,", invoiceId);
  try {
    const pid = extractProductId(product.product_id);

    if (!pid) {
      return {
        success: false,
        message: `Invalid product_id for: ${product?.name}`
      };
    }

    if (!product.qty || !product.purchase_price) {
      return {
        success: false,
        message: `Invalid qty or purchase_price for ${product?.name}`
      };
    }

    const productObjectId = new ObjectId(pid);

    const purchaseRecord = {
      invoice_id: invoiceId.toString(),
      qty: product.qty,
      purchase_price: product.purchase_price,
      subtotal: product.subtotal,
      date: new Date()
    };

    const existingItem = await inventoryCol.findOne({
      product_id: productObjectId
    });

    if (existingItem) {
      const oldQty = existingItem.stock_qty || 0;
      const oldAvg =
        existingItem.average_purchase_price ?? product.purchase_price;

      const newAvg =
        (oldAvg * oldQty +
          product.purchase_price * product.qty) /
        (oldQty + product.qty);

      await inventoryCol.updateOne(
        { product_id: productObjectId },
        {
          $inc: { stock_qty: product.qty },
          $set: {
            last_purchase_price: product.purchase_price,
            average_purchase_price: newAvg,
            last_updated: new Date()
          },
          $push: { purchase_history: purchaseRecord }
        }
      );

      return {
        success: true,
        message: `Inventory updated for ${product.name}`
      };
    }

    // New inventory item
    await inventoryCol.insertOne({
      product_id: productObjectId,
      item_name: product.name,
      stock_qty: product.qty,
      sale_price: null,
      last_purchase_price: product.purchase_price,
      average_purchase_price: product.purchase_price,
      reorder_level: 0,
      last_updated: new Date(),
      purchase_history: [purchaseRecord],
      sale_history: []
    });

    return {
      success: true,
      message: `New inventory item added: ${product.name}`
    };

  } catch (err) {
    return {
      success: false,
      message: `Inventory update failed: ${err.message}`
    };
  }
}


async function pushSaleHistory({ product_id, memo_id, qty, price = 0, subtotal = 0, date = new Date() }, session = null) {
  try {
    if (!product_id || !memo_id || !qty) {
      return { success: false, message: "Invalid sale history data" };
    }

    const productObjectId = typeof product_id === "string" ? new ObjectId(product_id) : product_id;
    const memoObjectId = typeof memo_id === "string" ? new ObjectId(memo_id) : memo_id;

    const saleRecord = {
      memo_id: memoObjectId,
      qty,
      price,
      subtotal,
      date
    };

    const result = await inventoryCol.updateOne(
      { product_id: productObjectId },
      { $push: { sale_history: saleRecord }, $set: { last_updated: new Date() } },
      session ? { session } : {}
    );

    if (result.modifiedCount > 0) {
      return { success: true, message: "Sale history pushed successfully" };
    }

    return { success: false, message: "No inventory item updated" };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function recalculateAveragePurchasePrice(product_id, session = null) {
  const productObjectId = new ObjectId(product_id);

  const inventory = await inventoryCol.findOne(
    { product_id: productObjectId },
    session ? { session } : {}
  );

  // 🔁 CHANGE: handle empty purchase history
  if (!inventory || !inventory.purchase_history?.length) {
    await inventoryCol.updateOne(
      { product_id: productObjectId },
      {
        $set: {
          average_purchase_price: 0,
          last_purchase_price: 0,
          last_updated: new Date()
        }
      },
      session ? { session } : {}
    );
    return;
  }

  let totalQty = 0;
  let totalValue = 0;

  for (const p of inventory.purchase_history) {
    totalQty += p.qty;
    totalValue += p.qty * p.purchase_price;
  }

  const avg = totalValue / totalQty;

  await inventoryCol.updateOne(
    { product_id: productObjectId },
    {
      $set: {
        average_purchase_price: Number(avg.toFixed(4)),
        last_purchase_price:
          inventory.purchase_history[inventory.purchase_history.length - 1]
            .purchase_price,
        last_updated: new Date()
      }
    },
    session ? { session } : {}
  );
}



module.exports = {
  increaseInventoryStock,
  decreaseInventoryStock,
  addToInventory,
  pushSaleHistory,
  recalculateAveragePurchasePrice
};
