const { ObjectId } = require("mongodb");
const { db } = require("../db.js");

const purchasesCol = db.collection("purchases");
const transactionsCol = db.collection("transactions");
const inventoryCollection = db.collection("inventory");
const cashCol = db.collection("cash");
const suppliersCol = db.collection("suppliers");

// -------------------- CREATE PURCHASE --------------------
async function createPurchase(req, res) {
  const { products, total_amount, paymentType = "cash", advance = 0, supplierId } = req.body;

  if (!products || !products.length) {
    return res.status(400).json({
      success: false,
      error: "Products array is required and cannot be empty",
    });
  }

  // Validate each product before doing anything else
  for (const p of products) {
    const pid = extractProductId(p.product_id);
    if (!pid) {
      return res.status(400).json({
        success: false,
        error: `Invalid product_id for product: ${p.name}`,
      });
    }
  }

  const invoiceId = new ObjectId();
  const purchaseDate = new Date();

  const rollbackOps = [];
  try {

    // ----- STEP 1: Insert Purchase Record -----
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

    // ----- STEP 2: Cash Handling -----
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
        particulars: `Purchase - ${products.map(p => `${p.name} x ${p.qty}`).join(", ")}`,
        products,
        amount: paidAmount,
        balance_after_transaction: newBalance,
        payment_details: { paidAmount, supplierDue: payment_due, paymentType },
        created_by: "admin",
      };

      await transactionsCol.insertOne(transactionData);
      rollbackOps.push(() => transactionsCol.deleteOne({ invoice_id: invoiceId.toString() }));

      await cashCol.updateOne({}, { $set: { balance: newBalance } }, { upsert: true });
      rollbackOps.push(() => cashCol.updateOne({}, { $set: { balance: lastBalance } }));
    }

    // ----- STEP 3: Inventory Update -----
    for (const product of products) {
      const result = await addToInventory(product, invoiceId);

      if (!result.success) {
        console.error("Inventory error:", result.message);
        throw new Error(result.message);
      }
    }

    // ----- STEP 4: Supplier Update -----
    if (supplierId) {
      const supplierObjectId = new ObjectId(supplierId);

      await suppliersCol.updateOne(
        { _id: supplierObjectId },
        {
          $set: { last_purchase_date: purchaseDate },
          $inc: { total_purchase: total_amount, total_due: payment_due },
        }
      );

      const purchasedProductNames = products.map(p => p.name);

      await suppliersCol.updateOne(
        { _id: supplierObjectId },
        { $addToSet: { supplied_products: { $each: purchasedProductNames } } }
      );

      await suppliersCol.updateOne(
        { _id: supplierObjectId },
        {
          $push: {
            supplier_history: {
              date: purchaseDate,
              type: "purchase",
              purchase_id: invoiceId,
              products,
              total_amount,
              paid_amount: paidAmount,
              due_after_payment: payment_due,
              remarks: "New purchase created",
            },
          },
        }
      );
    }

    return res.status(201).json({
      success: true,
      message: "Purchase processed successfully",
      invoiceId,
      newCashBalance: newBalance,
    });

  } catch (err) {
    console.error("Transaction failed:", err.message);

    for (const undo of rollbackOps.reverse()) {
      try {
        await undo();
      } catch (rollbackError) {
        console.error("Rollback failed:", rollbackError);
      }
    }

    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}


// -------------------- GET PURCHASES --------------------
async function getPurchases(req, res) {
  const query = req.query.type;
  try {
    const filter = query ? { payment_due: { $gt: 0 } } : {};
    const purchases = await purchasesCol.find(filter).sort({ date: -1 }).toArray();
    res.status(200).json({ success: true, data: purchases });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// -------------------- GET SINGLE PURCHASE --------------------
async function getPurchaseById(req, res) {
  const purchase_id = req.params.id;
  if (!purchase_id) return res.json({ success: false, message: 'purchase id not found' });
  try {
    const purchase = await purchasesCol.findOne({ _id: new ObjectId(purchase_id) });
    if (!purchase) return res.status(404).json({ success: false, message: "Purchase not found" });
    res.status(200).json({ success: true, data: purchase });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// -------------------- UPDATE PURCHASE --------------------
async function updatePurchase(req, res) {
  try {
    const purchaseId = new ObjectId(req.params.id);
    const { products, totalAmount, paidAmount, paymentType, supplierId } = req.body;
    const payment_due = totalAmount - paidAmount;

    const existingPurchase = await purchasesCol.findOne({ _id: purchaseId });
    if (!existingPurchase) return res.status(404).json({ success: false, message: "Purchase not found" });

    // Revert old inventory
    for (const item of existingPurchase.products || []) {
      const result = await deductFromInventory(item, purchaseId);
      if (!result.success) return res.status(400).json({ success: false, message: `Revert failed: ${result.message}` });
    }

    // Revert old cash if cash payment
    const oldPaid = existingPurchase.paidAmount || 0;
    const oldPaymentType = existingPurchase.paymentType;
    if (oldPaid && oldPaymentType === "cash") {
      const result = await decreaseCash(oldPaid, "invoice", {
        invoiceId: purchaseId,
        products: existingPurchase.products,
        paymentDetails: { paidAmount: oldPaid, supplierDue: existingPurchase.totalAmount - oldPaid, paymentType: oldPaymentType },
      });
      if (!result.success) return res.status(400).json({ success: false, message: `Failed to revert old cash: ${result.message}` });
    }

    // Revert old supplier totals
    if (existingPurchase.supplierId) {
      const supplierObjId = new ObjectId(existingPurchase.supplierId);
      const totalOldPurchase = existingPurchase.totalAmount || 0;
      const totalOldDue = (existingPurchase.totalAmount || 0) - (existingPurchase.paidAmount || 0);

      await suppliersCol.updateOne(
        { _id: supplierObjId },
        { $inc: { total_purchase: -totalOldPurchase, total_due: -totalOldDue }, $set: { last_purchase_date: new Date() } }
      );
    }

    // Add new inventory
    for (const item of products || []) {
      const result = await addToInventory(item, purchaseId);
      if (!result.success) return res.status(400).json({ success: false, message: `Add failed: ${result.message}` });
    }

    // Record new cash if cash payment
    if (paidAmount && paymentType === "cash") {
      const result = await decreaseCash(paidAmount, "invoice", {
        invoiceId: purchaseId,
        products,
        paymentDetails: { paidAmount, supplierDue: totalAmount - paidAmount, paymentType },
      });
      if (!result.success) return res.status(400).json({ success: false, message: `Failed to record cash: ${result.message}` });
    }

    // Update supplier totals
    if (supplierId) {
      const supplierObjId = new ObjectId(supplierId);
      const supplierDue = totalAmount - paidAmount;

      await suppliersCol.updateOne(
        { _id: supplierObjId },
        { $inc: { total_purchase: totalAmount, total_due: supplierDue }, $set: { last_purchase_date: new Date() } }
      );

      // Add supplier history for updated purchase
      await suppliersCol.updateOne(
        { _id: supplierObjId },
        {
          $push: {
            supplier_history: {
              date: new Date(),
              type: "updated_purchase",
              purchase_id: purchaseId,
              products,
              total_amount: totalAmount,
              paid_amount: paidAmount,
              due_after_payment: payment_due,
              remarks: "Purchase updated"
            }
          }
        }
      );
    }

    // Update purchase record
    await purchasesCol.updateOne(
      { _id: purchaseId },
      { $set: { products, totalAmount, paidAmount, paymentType, payment_due, supplierId: supplierId ? new ObjectId(supplierId) : null, date: new Date() } }
    );

    const updatedPurchase = await purchasesCol.findOne({ _id: purchaseId });

    res.status(200).json({ success: true, message: "Purchase updated successfully", data: updatedPurchase });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// -------------------- PAY SUPPLIER DUE --------------------
async function paySupplierDue(req, res) {
  try {
    const purchaseId = new ObjectId(req.params.id);
    const { payAmount, paymentMethod="cash" } = req.body;

    if (!payAmount || payAmount <= 0) return res.status(400).json({ success: false, message: "Invalid payment amount." });

    const purchase = await purchasesCol.findOne({ _id: purchaseId });
    if (!purchase) return res.status(404).json({ success: false, message: "Purchase not found" });

    const oldPaid = purchase.paidAmount || 0;
    const oldTotal = purchase.totalAmount || 0;
    const oldDue = oldTotal - oldPaid;
    if (payAmount > oldDue) return res.status(400).json({ success: false, message: "Payment exceeds due amount" });

    // Update cash ledger if cash payment
    if (paymentMethod === "cash") {
      const result = await decreaseCash(payAmount, "supplier_due_payment", {
        purchaseId,
        previousPaid: oldPaid,
        payAmount,
      });
      if (!result.success) return res.status(400).json({ success: false, message: "Failed to record cash transaction" });
    }

    // Update supplier totals
    if (purchase.supplierId) {
      const supplierObjId = new ObjectId(purchase.supplierId);
      await suppliersCol.updateOne(
        { _id: supplierObjId },
        {
          $inc: { total_due: -payAmount },
          $set: { last_payment_date: new Date() }
        }
      );

      // Add supplier transaction history
      await suppliersCol.updateOne(
        { _id: supplierObjId },
        {
          $push: {
            supplier_history: {
              date: new Date(),
              type: "due_payment",
              purchase_id: purchaseId,
              paid_amount: payAmount,
              previous_due: oldDue,
              due_after_payment: oldDue - payAmount,
              payment_method: paymentMethod,
              remarks: "Due partially or fully paid"
            }
          }
        }
      );
    }

    // Update purchase payment fields
    const updatedPaid = oldPaid + payAmount;
    const newDue = oldTotal - updatedPaid;
    await purchasesCol.updateOne(
      { _id: purchaseId },
      { $set: { paidAmount: updatedPaid, payment_due: newDue, paymentType: paymentMethod, last_payment_date: new Date() } }
    );

    const updatedPurchase = await purchasesCol.findOne({ _id: purchaseId });

    res.status(200).json({ success: true, message: "Supplier due paid successfully", data: updatedPurchase });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// -------------------- DELETE PURCHASE --------------------
async function deletePurchase(req, res) {
  try {
    const purchaseId = new ObjectId(req.params.id);
    const existingPurchase = await purchasesCol.findOne({ _id: purchaseId });
    if (!existingPurchase) return res.status(404).json({ success: false, message: "Purchase not found" });

    await purchasesCol.deleteOne({ _id: purchaseId });
    res.status(200).json({ success: true, message: "Purchase deleted successfully" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// -------------------- INVENTORY HELPERS --------------------
async function addToInventory(product, invoiceId) {
  try {
    const pid = extractProductId(product.product_id);

    if (!pid) {
      return {
        success: false,
        message: `Invalid product_id for: ${product?.name}`,
      };
    }

    const productObjectId = new ObjectId(pid);

    if (!product.qty || !product.purchase_price) {
      return {
        success: false,
        message: `Invalid qty or purchase_price for product: ${product.name}`,
      };
    }

    const purchaseRecord = {
      invoice_id: invoiceId.toString(),
      qty: product.qty,
      purchase_price: product.purchase_price,
      subtotal: product.subtotal,
      date: new Date(),
    };

    const existingItem = await inventoryCollection.findOne({
      product_id: productObjectId,
    });

    if (existingItem) {
      const oldQty = existingItem.total_stock_qty || 0;
      const oldAvg = existingItem.average_purchase_price || product.purchase_price;

      const newAvg =
        (oldAvg * oldQty + product.purchase_price * product.qty) /
        (oldQty + product.qty);

      await inventoryCollection.updateOne(
        { product_id: productObjectId },
        {
          $inc: { total_stock_qty: product.qty },
          $set: {
            last_purchase_price: product.purchase_price,
            average_purchase_price: newAvg,
            last_updated: new Date(),
          },
          $push: { purchase_history: purchaseRecord },
        }
      );

      return { success: true, message: `Inventory updated for ${product.name}` };
    } else {
      await inventoryCollection.insertOne({
        product_id: productObjectId,
        item_name: product.name,
        total_stock_qty: product.qty,
        sale_price: null,
        last_purchase_price: product.purchase_price,
        average_purchase_price: product.purchase_price,
        reorder_level: 0,
        last_updated: new Date(),
        purchase_history: [purchaseRecord],
        sale_history: [],
      });

      return { success: true, message: `New inventory item added: ${product.name}` };
    }
  } catch (error) {
    return {
      success: false,
      message: `Failed to update inventory for ${product?.name}: ${error.message}`,
    };
  }
}


function extractProductId(rawId) {
  if (!rawId) return null;

  // CASE 1: Extended JSON { "$oid": "id" }
  if (typeof rawId === "object" && rawId.$oid) {
    return rawId.$oid;
  }

  // CASE 2: Plain string
  if (typeof rawId === "string") {
    return rawId;
  }

  // CASE 3: ObjectId instance
  if (rawId instanceof ObjectId) {
    return rawId.toString();
  }

  return null;
}


async function deductFromInventory(product, memoId) {
  try {
    const productId = product.product_id || product._id;
    if (!productId || !product.qty) return { success: false, message: `Invalid product data (${product?.name || "Unknown"})` };

    const existingItem = await inventoryCollection.findOne({ product_id: new ObjectId(productId) });
    if (!existingItem) return { success: false, message: `Product not found: ${product.name}` };

    const saleRecord = {
      memo_id: memoId.toString(),
      qty: product.qty,
      price: product.price || product.purchase_price || 0,
      subtotal: product.subtotal || 0,
      date: new Date()
    };

    const result = await inventoryCollection.updateOne(
      { product_id: new ObjectId(productId) },
      { $inc: { total_stock_qty: -product.qty }, $set: { last_updated: new Date() }, $push: { sale_history: saleRecord } }
    );

    if (result.modifiedCount > 0) return { success: true, message: `Inventory updated for ${product.name}` };
    return { success: false, message: `No update occurred for ${product.name}` };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// -------------------- CASH HELPERS --------------------
async function increaseCash(amount, entrySource, details = {}) {
  try {
    const cashAccount = await cashCol.findOne({});
    const lastBalance = cashAccount?.current_balance || 0;
    const newBalance = lastBalance + amount;

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

    await cashCol.updateOne({}, { $set: { current_balance: newBalance } }, { upsert: true });
    return { success: true, newBalance, message: "Cash increased successfully" };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function decreaseCash(amount, entrySource, details = {}) {
  try {
    const cashAccount = await cashCol.findOne({});
    const lastBalance = cashAccount?.current_balance || 0;
    const newBalance = lastBalance - amount;

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

    await cashCol.updateOne({}, { $set: { current_balance: newBalance } }, { upsert: true });
    return { success: true, newBalance, message: "Cash decreased successfully" };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

module.exports = {
  createPurchase,
  getPurchases,
  getPurchaseById,
  updatePurchase,
  deletePurchase,
  paySupplierDue,
};
