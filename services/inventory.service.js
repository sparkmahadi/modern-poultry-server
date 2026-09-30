const { ObjectId } = require("mongodb");
const { db } = require("../db");
const { extractProductId } = require("../utils/id.util");

const inventoryCol = db.collection("inventory");

/**
 * Increase Inventory stock (Stock IN)
 */
async function increaseInventoryStock({ product_id, qty }, session = null) {
  try {
    const pid = extractProductId(product_id);
    const numQty = Number(qty);

    if (!pid || !numQty || numQty <= 0) {
      return { success: false, message: "Invalid product_id or qty" };
    }

    const options = session ? { session } : {};
    const result = await inventoryCol.updateOne(
      { product_id: new ObjectId(pid) },
      {
        $inc: { stock_qty: numQty },
        $set: { last_updated: new Date() }
      },
      options
    );

    if (result.matchedCount === 0) {
      return { success: false, message: "Inventory item not found" };
    }

    return { success: true, message: "Inventory stock increased" };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

/**
 * Decrease Inventory stock (Stock OUT)
 */
async function decreaseInventoryStock({ product_id, qty }, session = null) {
  try {
    const pid = extractProductId(product_id);
    const numQty = Number(qty);

    if (!pid || !numQty || numQty <= 0) {
      return { success: false, message: "Invalid product_id or qty" };
    }

    const options = session ? { session } : {};
    const inventoryItem = await inventoryCol.findOne(
      { product_id: new ObjectId(pid) },
      options
    );

    if (!inventoryItem) {
      return { success: false, message: "Inventory item not found" };
    }

    if (Number(inventoryItem.stock_qty || 0) < numQty) {
      return { 
        success: false, 
        message: "Insufficient stock quantity", 
        available: inventoryItem.stock_qty, 
        requested: numQty 
      };
    }

    await inventoryCol.updateOne(
      { product_id: new ObjectId(pid) },
      {
        $inc: { stock_qty: -numQty },
        $set: { last_updated: new Date() }
      },
      options
    );

    return { success: true, message: "Inventory stock decreased" };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

/**
 * Add incoming purchase stock to inventory and calculate weighted average purchase price.
 */
async function addToInventory(product, invoiceId, session = null) {
  try {
    const pid = extractProductId(product.product_id);

    if (!pid) {
      return { success: false, message: `Invalid product_id for: ${product?.name || "Product"}` };
    }

    const qty = Number(product.qty || 0);
    const purchasePrice = Number(product.purchase_price || 0);

    if (qty <= 0 || purchasePrice <= 0) {
      return { success: false, message: `Invalid qty or purchase_price for ${product?.name || pid}` };
    }

    const productObjectId = new ObjectId(pid);
    const purchaseRecord = {
      invoice_id: invoiceId.toString(),
      qty,
      purchase_price: purchasePrice,
      subtotal: Number(product.subtotal || qty * purchasePrice),
      date: new Date()
    };

    const options = session ? { session } : {};
    const existingItem = await inventoryCol.findOne({ product_id: productObjectId }, options);

    if (existingItem) {
      // Guard against negative/zero prior stock distorting weighted average price
      const validOldQty = Math.max(0, Number(existingItem.stock_qty || 0));
      const oldAvg = Number(existingItem.average_purchase_price ?? purchasePrice);

      const newAvg = validOldQty === 0
        ? purchasePrice
        : ((oldAvg * validOldQty) + (purchasePrice * qty)) / (validOldQty + qty);

      await inventoryCol.updateOne(
        { product_id: productObjectId },
        {
          $inc: { stock_qty: qty },
          $set: {
            last_purchase_price: purchasePrice,
            average_purchase_price: Number(newAvg.toFixed(4)),
            last_updated: new Date()
          },
          $push: { purchase_history: purchaseRecord }
        },
        options
      );

      return { success: true, message: `Inventory updated for ${product.name}` };
    }

    // New item insertion if product does not yet exist in inventory
    await inventoryCol.insertOne({
      product_id: productObjectId,
      item_name: product.name || "",
      stock_qty: qty,
      sale_price: null,
      last_purchase_price: purchasePrice,
      average_purchase_price: purchasePrice,
      reorder_level: 0,
      last_updated: new Date(),
      purchase_history: [purchaseRecord],
      sale_history: []
    }, options);

    return { success: true, message: `New inventory item added: ${product.name}` };
  } catch (err) {
    return { success: false, message: `Inventory update failed: ${err.message}` };
  }
}

/**
 * Recalculate Average Purchase Price across recent purchase history entries.
 */
async function recalculateAveragePurchasePrice(product_id, session = null) {
  const productIdStr = extractProductId(product_id);
  if (!productIdStr) return;

  const productObjectId = new ObjectId(productIdStr);
  const options = session ? { session } : {};
  const inventory = await inventoryCol.findOne({ product_id: productObjectId }, options);

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
      options
    );
    return;
  }

  let totalQty = 0;
  let totalValue = 0;

  for (const p of inventory.purchase_history) {
    const q = Number(p.qty || 0);
    const price = Number(p.purchase_price || 0);
    totalQty += q;
    totalValue += q * price;
  }

  const avg = totalQty > 0 ? totalValue / totalQty : 0;
  const lastPrice = inventory.purchase_history[inventory.purchase_history.length - 1].purchase_price;

  await inventoryCol.updateOne(
    { product_id: productObjectId },
    {
      $set: {
        average_purchase_price: Number(avg.toFixed(4)),
        last_purchase_price: lastPrice,
        last_updated: new Date()
      }
    },
    options
  );
}

module.exports = {
  increaseInventoryStock,
  decreaseInventoryStock,
  addToInventory,
  recalculateAveragePurchasePrice
};