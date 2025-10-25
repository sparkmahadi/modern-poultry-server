const { ObjectId } = require("mongodb");
const { db } = require("../db.js");

const salesCol = db.collection("sales");
const dueSalesCol = db.collection("due-sales");
const cashSalesCol = db.collection("cash-sales");
const transactionsCol = db.collection("transactions");

const inventoryCollection = db.collection("inventory");
const cashCol = db.collection("cash");
const customersCol = db.collection("customers");

module.exports.createSell = async (req, res) => {
  console.log("🧾 Hit createSell");
  const { memoNo, date, customer, products, total, paidAmount = 0, due = 0 } = req.body;

  if (!products || products.length === 0) {
    return res.status(400).json({ success: false, error: "No products provided" });
  }

  if (!customer || !customer.name) {
    return res.status(400).json({ success: false, error: "Customer information required" });
  }

  const memoId = new ObjectId();
  const sellDate = date ? new Date(date) : new Date();

  // To track all steps for manual rollback if any step fails
  const rollbackOps = [];

  try {
    // STEP 1️⃣: Deduct sold quantities from inventory
    for (const item of products) {
      await deductFromInventory(item, memoId.toString());
    }
    rollbackOps.push(async () => {
      // Optional: add a reverse function if your inventory logic supports adding back
      for (const item of products) {
        await addToInventory(item, memoId.toString());
      }
    });

    // STEP 2️⃣: Get current cash balance
    const cashAccount = await cashCol.findOne({});
    const lastBalance = cashAccount?.balance || 0;
    let newBalance = lastBalance;

    // STEP 3️⃣: Record transaction (only if some cash was received)
    if (paidAmount > 0) {
      newBalance = lastBalance + paidAmount;

      const transactionData = {
        date: sellDate,
        time: sellDate.toTimeString().split(" ")[0],
        entry_source: "sale_memo",
        memo_id: memoId.toString(),
        transaction_type: "credit",
        particulars: `Sale - ${products.map(p => `${p.item_name} x ${p.qty}`).join(", ")}`,
        products,
        amount: paidAmount,
        balance_after_transaction: newBalance,
        payment_details: { paidAmount, due, paymentType: "cash" },
        created_by: "admin",
        remarks: "Auto entry from sale memo"
      };

      await transactionsCol.insertOne(transactionData);
      rollbackOps.push(() => transactionsCol.deleteOne({ memo_id: memoId.toString() }));

      await cashCol.updateOne({}, { $set: { balance: newBalance } }, { upsert: true });
      rollbackOps.push(() => cashCol.updateOne({}, { $set: { balance: lastBalance } }));
    }

    // STEP 4️⃣: Record the sale memo
    const saleData = {
      _id: memoId,
      memoNo,
      date: sellDate,
      customerId: new ObjectId(customer._id),
      customerName: customer.name,
      products,
      total,
      paidAmount,
      due,
      createdAt: new Date()
    };

    await salesCol.insertOne(saleData);
    rollbackOps.push(() => salesCol.deleteOne({ _id: memoId }));

    // step 5
    if (paidAmount < total) {
      await dueSalesCol.insertOne(saleData);
      rollbackOps.push(() => dueSalesCol.deleteOne({ _id: memoId }));
    } else {
      await cashSalesCol.insertOne(saleData);
      rollbackOps.push(() => cashSalesCol.deleteOne({ _id: memoId }));
    }

    // STEP 5️⃣: Update Customer Profile
    const purchasedProductNames = products.map((p) => p.item_name);

    await customersCol.updateOne(
      { _id: new ObjectId(customer._id) },
      {
        $set: { last_purchase_date: sellDate },
        $inc: { total_sales: total, total_due: due * 1 },
        $addToSet: { purchased_products: { $each: purchasedProductNames } },
      },
      { upsert: false }
    );

    // STEP 6️⃣: (Optional) Update reports
    // await reportsCol.updateOne(...)

    // ✅ Success
    res.status(201).json({
      success: true,
      message: "Sell memo created successfully",
      memoId,
      newCashBalance: newBalance
    });

  } catch (err) {
    console.error("❌ Error creating sell memo:", err);

    // 🔁 Rollback previous successful steps in reverse order
    for (const undo of rollbackOps.reverse()) {
      try {
        await undo();
      } catch (rollbackError) {
        console.error("Rollback step failed:", rollbackError);
      }
    }

    res.status(500).json({ success: false, error: err.message });
  }
};



module.exports.getSales = async (req, res) => {
  try {
    const sales = await salesCol.find({}).toArray();
    res.status(200).json({ success: true, data: sales });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports.getCashSales = async (req, res) => {
  try {
    const sales = await cashSalesCol.find({}).toArray();
    res.status(200).json({ success: true, data: sales });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports.getDueSales = async (req, res) => {
  try {
    const sales = await dueSalesCol.find({}).toArray();
    res.status(200).json({ success: true, data: sales });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}


// 🟢 Add purchased products to inventory
async function addToInventory(product, invoiceId) {
  console.log("🟢 [addToInventory] Called with:", {
    product_id: product?.product_id,
    name: product?.item_name,
    qty: product?.qty,
    invoiceId
  });

  try {
    // 🔸 Validate product data
    if (!product || !product.product_id || !product.qty || !product.purchase_price) {
      console.error("❌ [addToInventory] Invalid product data:", product);
      return { success: false, message: `Invalid product data for: ${product?.item_name || "Unnamed product"}` };
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
      console.log(`🟡 [addToInventory] Updating existing item: ${product.item_name}`);

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

      console.log(`✅ [addToInventory] Updated inventory for ${product.item_name}`);
      return { success: true, message: `Inventory updated for ${product.item_name}` };
    } else {
      console.log(`🟢 [addToInventory] Adding new inventory item: ${product.item_name}`);

      // 🔹 Insert new product
      await inventoryCollection.insertOne({
        product_id: new ObjectId(product.product_id),
        item_name: product.item_name,
        total_stock_qty: product.qty,
        sale_price: null,
        last_purchase_price: product.purchase_price,
        average_purchase_price: product.purchase_price,
        reorder_level: 0,
        last_updated: new Date(),
        purchase_history: [purchaseRecord],
        sale_history: []
      });

      console.log(`✅ [addToInventory] New item added: ${product.item_name}`);
      return { success: true, message: `New inventory item added: ${product.item_name}` };
    }
  } catch (error) {
    console.error("❌ [addToInventory ERROR]:", error.message);
    return { success: false, message: `Failed to update inventory for ${product?.item_name || "unknown item"}: ${error.message}` };
  }
}



// 🔴 Deduct sold or old purchased products from inventory
async function deductFromInventory(product, memoId) {
  try {
    // ✅ Fallback to _id for backward compatibility
    const productId = product.product_id || product._id;

    if (!productId || !product.qty) {
      console.error("❌ [deductFromInventory] Invalid product data:", product);
      return { success: false, message: `Invalid product data for inventory deduction (${product?.item_name || "Unknown"})` };
    }

    console.log("🟡 [deductFromInventory] Processing:", {
      product_id: productId,
      name: product?.item_name,
      qty: product.qty,
      memoId
    });

    const existingItem = await inventoryCollection.findOne({ product_id: new ObjectId(productId) });

    if (!existingItem) {
      console.warn(`⚠️ [deductFromInventory] Product not found in inventory: ${product?.item_name}`);
      return { success: false, message: `Product not found in inventory: ${product?.item_name}` };
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
      console.log(`✅ [deductFromInventory] Deducted ${product.qty} from ${product?.item_name}`);
      return { success: true, message: `Inventory updated for ${product?.item_name}` };
    } else {
      console.warn(`⚠️ [deductFromInventory] No change for ${product?.item_name}`);
      return { success: false, message: `No update occurred for ${product?.item_name}` };
    }
  } catch (err) {
    console.error("❌ [deductFromInventory ERROR]:", err);
    return { success: false, message: err.message };
  }
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

async function increaseCash(amount, entrySource, details = {}) {
  console.log('cash increase requested by', amount, entrySource, details);
  try {
    const cashAccount = await cashCol.findOne({});
    const lastBalance = cashAccount?.balance || 0;
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
    await cashCol.updateOne({}, { $set: { balance: newBalance } }, { upsert: true });

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
    const lastBalance = cashAccount?.balance || 0;
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
    await cashCol.updateOne({}, { $set: { balance: newBalance } }, { upsert: true });

    return { success: true, newBalance, message: "Cash decreased successfully" };
  } catch (err) {
    console.error("❌ [decreaseCash ERROR]:", err);
    return { success: false, message: err.message };
  }
}