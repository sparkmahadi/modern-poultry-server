const { ObjectId } = require("mongodb");
const { db } = require("../db.js");

const purchasesCol = db.collection("purchases");
const transactionsCol = db.collection("transactions");
const inventoryCollection = db.collection("inventory");
const cashCol = db.collection("cash");
const suppliersCol = db.collection("suppliers");


async function createPurchase(req, res) {
  const { products, total_amount, paymentType = "cash", advance = 0, supplierId } = req.body;
  console.log(req.body);

  if (!products || products.length === 0) {
    return res.status(400).json({ success: false, error: "No products provided" });
  }

  const invoiceId = new ObjectId();
  const purchaseDate = new Date();

  try {
    // Initialize rollback record
    const rollbackOps = [];

    // STEP 1️⃣: Create Purchase Record
    const paidAmount = advance;
    const payment_due = total_amount - paidAmount;

    const purchaseData = {
      _id: invoiceId,
      supplierId: supplierId ? new ObjectId(supplierId) : null,
      products,
      totalAmount: total_amount,
      paidAmount,
      payment_due,
      paymentType,
      date: purchaseDate,
    };

    await purchasesCol.insertOne(purchaseData);
    rollbackOps.push(() => purchasesCol.deleteOne({ _id: invoiceId }));

    // STEP 2️⃣: Handle Cash Transaction
    let cashAccount = await cashCol.findOne({});
    const lastBalance = cashAccount?.balance || 0;
    let newBalance = lastBalance;

    if (paymentType === "cash") {
      newBalance = lastBalance - paidAmount;
      const transactionData = {
        date: purchaseDate,
        time: purchaseDate.toTimeString().split(" ")[0],
        entry_source: "invoice",
        invoice_id: invoiceId.toString(),
        transaction_type: "debit",
        particulars: `Purchase - ${products.map((p) => `${p.name} x ${p.qty}`).join(", ")}`,
        products,
        amount: paidAmount,
        balance_after_transaction: newBalance,
        payment_details: { paidAmount, supplierDue: payment_due, paymentType },
        created_by: "admin",
      };

      await transactionsCol.insertOne(transactionData);
      rollbackOps.push(() => transactionsCol.deleteOne({ invoice_id: invoiceId.toString() }));
      console.log('new balance before update cash', newBalance);
      await cashCol.updateOne({}, { $set: { balance: newBalance } }, { upsert: true });
      rollbackOps.push(() => cashCol.updateOne({}, { $set: { balance: lastBalance } }));
    }

    // STEP 3️⃣: Update Inventory
    for (const product of products) {
      try {
        await addToInventory(product, invoiceId);
      } catch (err) {
        console.error("Failed adding product to inventory:", product.name, err.message);
        throw new Error(`Inventory update failed for ${product.name}`);
      }
    }

    // STEP 4️⃣: Update Supplier Profile
    if (supplierId) {
      const supplierObjectId = new ObjectId(supplierId);

      // 4a. Add supplier purchase summary
      await suppliersCol.updateOne(
        { _id: supplierObjectId },
        {
          $set: { last_purchase_date: purchaseDate },
          $inc: { total_purchase: total_amount, total_due: payment_due },
          $setOnInsert: { status: "active" },
        }
      );

      // 4b. Add purchased products to supplier’s product list
      const purchasedProductNames = products.map((p) => p.name);
      await suppliersCol.updateOne(
        { _id: supplierObjectId },
        {
          $addToSet: {
            supplied_products: { $each: purchasedProductNames },
          },
        }
      );
    }

    // STEP 5️⃣: (Optional) Update Reports Here
    // await reportsCol.updateOne(...)

    res.status(201).json({
      success: true,
      message: "Purchase processed successfully",
      invoiceId,
      newCashBalance: newBalance,
    });
  } catch (err) {
    console.error("❌ Transaction failed:", err);

    // Rollback partial steps if anything fails
    for (const undo of rollbackOps.reverse()) {
      try {
        await undo();
      } catch (rollbackError) {
        console.error("Rollback step failed:", rollbackError);
      }
    }

    res.status(500).json({ success: false, error: err.message });
  }
}





// GET all purchases
async function getPurchases(req, res) {
  try {
    const purchases = await purchasesCol.find().sort({ date: -1 }).toArray();
    res.status(200).json({ success: true, data: purchases });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// GET single purchase by ID
async function getPurchaseById(req, res) {
  const purchase_id = req.params.id;
  if (purchase_id) {
    try {
      const purchase = await purchasesCol.findOne({ _id: new ObjectId(req.params.id) });
      console.log(purchase);
      if (!purchase) return res.status(404).json({ success: false, message: "Purchase not found" });
      res.status(200).json({ success: true, data: purchase });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  } else {
    res.json({ success: false, message: 'purchase id not found' })
  }

}


// 📦 UPDATE PURCHASE
async function updatePurchase(req, res) {
  try {
    console.log("🟢 [UPDATE PURCHASE] Request received");

    const purchaseId = new ObjectId(req.params.id);
    const { products, totalAmount, paidAmount, paymentType, supplierId } = req.body;

    console.log("🟡 Purchase ID:", purchaseId);
    console.log("🟡 Request Body:", req.body);

    const existingPurchase = await purchasesCol.findOne({ _id: purchaseId });
    if (!existingPurchase) {
      console.error("❌ Purchase not found");
      return res.status(404).json({ success: false, message: "Purchase not found" });
    }

    console.log("🟢 Existing purchase fetched successfully");

    // 🔹 1️⃣ Revert old inventory
    console.log("🟠 Reverting inventory for old products...");
    for (const item of existingPurchase.products || []) {
      console.log(`   ↪ Reverting inventory for: ${item.name || "Unnamed product"}`);
      const result = await deductFromInventory(item, purchaseId);
      if (!result.success) {
        console.error("❌ Failed during revert:", result.message);
        return res.status(400).json({ success: false, message: `Revert failed: ${result.message}` });
      }
    }

    // 🔹 2️⃣ Revert old cash if previous payment was cash
    const oldPaid = existingPurchase.paidAmount || 0;
    const oldPaymentType = existingPurchase.paymentType;
    if (oldPaid && oldPaymentType === "cash") {
      console.log(`🟠 Reverting old cash transaction: ${oldPaid}`);
      const result = await decreaseCash(oldPaid, "invoice", {
        invoiceId: purchaseId,
        products: existingPurchase.products,
        paymentDetails: { paidAmount: oldPaid, supplierDue: existingPurchase.totalAmount - oldPaid, paymentType: oldPaymentType },
      });
      if (!result.success) {
        console.error("❌ Failed to revert old cash:", result.message);
        return res.status(400).json({ success: false, message: `Failed to revert old cash: ${result.message}` });
      }
    }

    // 🔹 3️⃣ Revert old supplier totals
    if (existingPurchase.supplierId) {
      const supplierObjId = new ObjectId(existingPurchase.supplierId);
      const totalOldPurchase = existingPurchase.totalAmount || 0;
      const totalOldDue = (existingPurchase.totalAmount || 0) - (existingPurchase.paidAmount || 0);

      await suppliersCol.updateOne(
        { _id: supplierObjId },
        { $inc: { total_purchase: -totalOldPurchase, total_due: -totalOldDue }, $set: { last_purchase_date: new Date() } }
      );

      console.log("🟠 Reverted old supplier totals");
    }

    // 🔹 4️⃣ Add new inventory
    console.log("🟢 Updating inventory for new products...");
    for (const item of products || []) {
      const result = await addToInventory(item, purchaseId);
      if (!result.success) {
        console.error("❌ Failed while adding inventory:", result.message);
        return res.status(400).json({ success: false, message: `Add failed: ${result.message}` });
      }
    }

    // 🔹 5️⃣ Record new cash if payment is cash
    if (paidAmount && paymentType === "cash") {
      console.log(`🟢 Recording new cash transaction: ${paidAmount}`);
      const result = await decreaseCash(paidAmount, "invoice", {
        invoiceId: purchaseId,
        products,
        paymentDetails: { paidAmount, supplierDue: totalAmount - paidAmount, paymentType },
      });
      if (!result.success) {
        console.error("❌ Failed to record new cash:", result.message);
        return res.status(400).json({ success: false, message: `Failed to record cash: ${result.message}` });
      }
    }

    // 🔹 6️⃣ Update supplier totals
    if (supplierId) {
      const supplierObjId = new ObjectId(supplierId);
      const supplierDue = totalAmount - paidAmount;

      await suppliersCol.updateOne(
        { _id: supplierObjId },
        { $inc: { total_purchase: totalAmount, total_due: supplierDue }, $set: { last_purchase_date: new Date() } }
      );

      console.log("🟢 Supplier totals updated");
    }

    // 🔹 7️⃣ Update purchase record
    await purchasesCol.updateOne(
      { _id: purchaseId },
      { $set: { products, totalAmount, paidAmount, paymentType, supplierId: supplierId ? new ObjectId(supplierId) : null, date: new Date() } }
    );

    console.log("✅ Purchase record updated successfully");

    res.status(200).json({ success: true, message: "Purchase updated successfully", updatedPurchaseId: purchaseId });

  } catch (err) {
    console.error("❌ [UPDATE PURCHASE ERROR]:", err);
    res.status(500).json({ success: false, error: err.message });
  }
}





// UPDATE purchase
async function paySupplierDue(req, res) {
  try {
    const purchaseId = new ObjectId(req.params.id);
    const { products, totalAmount, paidAmount, paymentType, supplierId } = req.body;

    const existingPurchase = await purchasesCol.findOne({ _id: purchaseId });
    if (!existingPurchase) return res.status(404).json({ success: false, message: "Purchase not found" });

    // Revert inventory for old products
    for (const item of existingPurchase.products) {
      await deductFromInventory(item, purchaseId);
    }

    // Update inventory for new products
    for (const item of products) {
      await addToInventory(item, purchaseId);
    }

    // Update purchase record
    await purchasesCol.updateOne(
      { _id: purchaseId },
      { $set: { products, totalAmount, paidAmount, paymentType, supplierId: supplierId ? new ObjectId(supplierId) : null, date: new Date() } }
    );

    res.status(200).json({ success: true, message: "Purchase updated successfully" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// DELETE purchase
async function deletePurchase(req, res) {
  try {
    const purchaseId = new ObjectId(req.params.id);
    console.log(purchaseId);

    const existingPurchase = await purchasesCol.findOne({ _id: purchaseId });
    if (!existingPurchase) return res.status(404).json({ success: false, message: "Purchase not found" });

    // Revert inventory
    // for (const item of existingPurchase.products) {
    //   await deductFromInventory(item, purchaseId);
    // }

    // Delete purchase record
    await purchasesCol.deleteOne({ _id: purchaseId });

    res.status(200).json({ success: true, message: "Purchase deleted successfully" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}


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
  createPurchase,
  getPurchases,
  getPurchaseById,
  updatePurchase,
  deletePurchase,
};
