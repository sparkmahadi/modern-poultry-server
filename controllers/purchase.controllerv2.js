// controllers/purchase.controller.js
const { ObjectId } = require("mongodb");
const { db } = require("../db.js");

const purchasesCol = db.collection("purchases");
const transactionsCol = db.collection("transactions");
const inventoryCollection = db.collection("inventory");
const accountsCol = db.collection("payments_accounts"); // unified accounts collection
const suppliersCol = db.collection("suppliers");

/**
 * Helper: resolve an account by provided accountId or legacy paymentType string.
 * - If accountId provided, returns that account
 * - Else if paymentType provided (cash|bank|bkash|nagad|rocket...), will attempt to return a single matching account
 *   (legacy compatibility). It will prefer type match (cash/bank/mobile) and, for mobile, method match.
 */
async function resolveAccount({ accountId, paymentType }) {
  if (accountId) {
    const acc = await accountsCol.findOne({ _id: new ObjectId(accountId) });
    return acc || null;
  }

  if (!paymentType) return null;

  const pt = paymentType.toLowerCase();
  if (pt === "cash") {
    return await accountsCol.findOne({ type: "cash" });
  }
  if (pt === "bank") {
    return await accountsCol.findOne({ type: "bank" });
  }
  // mobile wallets: bkash, nagad, rocket, etc.
  return await accountsCol.findOne({ type: "mobile", method: pt });
}

/**
 * Re-calculates running balances for a single account using its transactions.
 * Updates each transaction's balance_after_transaction and finally updates the account.balance.
 */
async function reProcessBalancesForAccount(accountId) {
  const accountIdStr = (accountId instanceof ObjectId) ? accountId.toString() : accountId;

  // get transactions for this account only, oldest first
  const txns = await transactionsCol
    .find({ account_id: accountIdStr })
    .sort({ date: 1, time: 1 })
    .toArray();

  let running = 0;
  for (const t of txns) {
    const amt = Number(t.amount || 0);
    if (t.transaction_type === "credit") running += amt;
    else running -= amt;

    running = Math.round(running * 100) / 100;

    await transactionsCol.updateOne(
      { _id: t._id },
      { $set: { balance_after_transaction: running } }
    );
  }

  await accountsCol.updateOne(
    { _id: new ObjectId(accountIdStr) },
    { $set: { balance: running } },
    { upsert: true }
  );

  return running;
}

/**
 * Create a transaction entry and update account balance immediately (used on create flow)
 * Returns inserted transaction id
 */
async function insertAccountTransaction({ account, entry_source, invoice_id, transaction_type, amount, particulars = "", details = {} }) {
  const accountIdStr = account._id.toString();
  const lastBalance = Number(account.balance || 0);
  const newBalance = transaction_type === "credit" ? lastBalance + Number(amount) : lastBalance - Number(amount);

  const txn = {
    date: new Date(),
    time: new Date().toTimeString().split(" ")[0],
    account_id: accountIdStr,
    entry_source,
    invoice_id: invoice_id ? invoice_id.toString() : null,
    transaction_type,
    particulars,
    amount: Number(amount),
    balance_after_transaction: newBalance,
    payment_details: details.paymentDetails || {},
    products: details.products || [],
    created_by: details.createdBy || "admin",
    remarks: details.remarks || ""
  };

  const result = await transactionsCol.insertOne(txn);

  // update account balance
  await accountsCol.updateOne(
    { _id: new ObjectId(accountIdStr) },
    { $set: { balance: newBalance } },
    { upsert: true }
  );

  return result.insertedId;
}

/**
 * Adjust an existing account by diff (positive -> debit/negative -> credit)
 * - If diff > 0: perform a debit (money out) of diff
 * - If diff < 0: perform a credit (money in) of -diff
 * This function inserts a transaction (with given entry_source & invoice_id) and updates account.balance.
 */
async function adjustAccountByDiff({ account, invoice_id, entry_source, diff, particulars = "", details = {} }) {
  const accountIdStr = account._id.toString();
  const lastBalance = Number(account.balance || 0);

  if (diff === 0) {
    // nothing to do
    return { success: true, newBalance: lastBalance, transactionId: null };
  }

  // diff > 0: we need to reduce account by diff -> it's a debit
  // diff < 0: we need to increase account by -diff -> it's a credit
  const amount = Math.abs(Number(diff));
  const transaction_type = diff > 0 ? "debit" : "credit";
  const newBalance = transaction_type === "debit" ? lastBalance - amount : lastBalance + amount;

  const txn = {
    date: new Date(),
    time: new Date().toTimeString().split(" ")[0],
    account_id: accountIdStr,
    entry_source,
    invoice_id: invoice_id ? invoice_id.toString() : null,
    transaction_type,
    particulars,
    amount,
    balance_after_transaction: newBalance,
    payment_details: details.paymentDetails || {},
    products: details.products || [],
    created_by: details.createdBy || "admin",
    remarks: details.remarks || ""
  };

  const r = await transactionsCol.insertOne(txn);
  await accountsCol.updateOne({ _id: new ObjectId(accountIdStr) }, { $set: { balance: newBalance } }, { upsert: true });

  // After adjusting, reprocess balances properly for account (to maintain ledger consistency)
  await reProcessBalancesForAccount(accountIdStr);

  return { success: true, newBalance, transactionId: r.insertedId };
}

/**
 * Update (overwrite) the original payment transaction associated with a purchase invoice_id.
 * If not found, creates a new transaction instead.
 * This function will set the transaction document's account_id, type, amount and then re-process balances.
 */
async function upsertInvoicePaymentTransaction({ invoice_id, account, transaction_type, amount, particulars = "", details = {} }) {
  const accountIdStr = account._id.toString();
  const invoiceIdStr = invoice_id.toString();

  // Try to find a transaction that was created for this invoice (entry_source 'invoice' or 'purchase')
  const existingTxn = await transactionsCol.findOne({ invoice_id: invoiceIdStr, entry_source: { $in: ["invoice", "purchase"] } });

  if (existingTxn) {
    // Update the transaction document (account id, amount, type). We'll recalc balances afterwards.
    await transactionsCol.updateOne(
      { _id: existingTxn._id },
      {
        $set: {
          account_id: accountIdStr,
          transaction_type,
          amount: Number(amount),
          particulars,
          payment_details: details.paymentDetails || {},
          products: details.products || [],
          time: new Date().toTimeString().split(" ")[0],
          date: new Date(),
          remarks: details.remarks || ""
        }
      }
    );
  } else {
    // Insert new txn
    await transactionsCol.insertOne({
      date: new Date(),
      time: new Date().toTimeString().split(" ")[0],
      account_id: accountIdStr,
      entry_source: "invoice",
      invoice_id: invoiceIdStr,
      transaction_type,
      particulars,
      amount: Number(amount),
      balance_after_transaction: 0, // will be corrected by reProcess
      payment_details: details.paymentDetails || {},
      products: details.products || [],
      created_by: details.createdBy || "admin",
      remarks: details.remarks || ""
    });
  }

  // Re-process balances for the affected account
  await reProcessBalancesForAccount(accountIdStr);
}

/* ======================
   CONTROLLER: createPurchase
   ====================== */
async function createPurchase(req, res) {
  const { products, total_amount, paymentAccountId , paymentType = "cash", advance = 0, supplierId } = req.body;

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
  const paidAmount = Number(advance || 0);
  const payment_due = Number(total_amount || 0) - Number(paidAmount);

  const purchaseData = {
    _id: invoiceId,
    supplierId: supplierId ? new ObjectId(supplierId) : null,
    products,
    totalAmount: Number(total_amount),
    paidAmount,
    payment_due,
    // store both for compatibility: prefer paymentAccountId for future lookups
    paymentAccountId: paymentAccountId || null,
    paymentType: paymentType || null,
    date: purchaseDate,
  };

  const rollbackOps = [];

  try {
    // Insert purchase record
    await purchasesCol.insertOne(purchaseData);
    rollbackOps.push(async () => await purchasesCol.deleteOne({ _id: invoiceId }));

    // Handle payment if there is a paid amount and it's not a 'due' transaction
    if (paidAmount > 0) {
      // Resolve account (new unified approach). If no account found and paymentType === 'due', skip.
      const account = await resolveAccount({ accountId: paymentAccountId, paymentType });
      if (!account) {
        // If paidAmount > 0 but no account resolved, fail
        throw new Error("Payment account not found for provided paymentAccountId/paymentType");
      }

      const particulars = `Purchase - ${products.map(p => `${p.name} x ${p.qty}`).join(", ")}`;

      // Insert transaction and update account balance
      const txnId = await insertAccountTransaction({
        account,
        entry_source: "invoice",
        invoice_id: invoiceId,
        transaction_type: "debit", // payment for purchase reduces account balance
        amount: paidAmount,
        particulars,
        details: { products, paymentDetails: { paidAmount, supplierDue: payment_due, paymentType: paymentType || account.method } }
      });

      rollbackOps.push(async () => {
        // delete created txn if rollback
        await transactionsCol.deleteOne({ _id: txnId });
      });
    }

    // Inventory update (add to inventory)
    for (const product of products) {
      const result = await addToInventory(product, invoiceId);
      if (!result.success) throw new Error(result.message);
    }

    // Supplier updates
    if (supplierId) {
      const supplierObjectId = new ObjectId(supplierId);

      await suppliersCol.updateOne(
        { _id: supplierObjectId },
        {
          $set: { last_purchase_date: purchaseDate },
          $inc: { total_purchase: Number(total_amount), total_due: payment_due },
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
              total_amount: Number(total_amount),
              paid_amount: paidAmount,
              due_after_payment: payment_due,
              remarks: "New purchase created",
            },
          },
        }
      );

      rollbackOps.push(async () => {
        // best-effort revert supplier history entry if rollback
        await suppliersCol.updateOne(
          { _id: supplierObjectId },
          { $pull: { supplier_history: { purchase_id: invoiceId } } }
        );
      });
    }

    // Return current balances for convenience (read some accounts)
    const cashAccount = await accountsCol.findOne({ type: "cash" });
    const bankAccount = await accountsCol.findOne({ type: "bank" });
    const bkashAccount = await accountsCol.findOne({ type: "mobile", method: "bkash" });

    return res.status(201).json({
      success: true,
      message: "Purchase processed successfully",
      invoiceId,
      newBalances: {
        cash: cashAccount ? Number(cashAccount.balance || 0) : null,
        bank: bankAccount ? Number(bankAccount.balance || 0) : null,
        bkash: bkashAccount ? Number(bkashAccount.balance || 0) : null,
      },
    });
  } catch (err) {
    console.error("Create purchase failed:", err.message);

    // rollback best-effort
    for (const undo of rollbackOps.reverse()) {
      try {
        await undo();
      } catch (rollbackErr) {
        console.error("Rollback op failed:", rollbackErr.message);
      }
    }

    return res.status(500).json({ success: false, error: err.message });
  }
}

/* ======================
   CONTROLLER: getPurchases / getPurchaseById
   (unchanged except minor compatibility)
   ====================== */
async function getPurchases(req, res) {
  const query = req.query.type;
  try {
    const filter = query === "due" ? { payment_due: { $gt: 0 } } : {};
    const purchases = await purchasesCol.find(filter).sort({ date: -1 }).toArray();
    res.status(200).json({ success: true, data: purchases });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

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

/* ======================
   CONTROLLER: updatePurchase (MIXED MODEL)
   - revert inventory fully
   - adjust supplier totals
   - adjust ledger by difference (update original transaction if exists)
   - re-add inventory and update purchase record
   ====================== */
async function updatePurchase(req, res) {
  try {
    const purchaseId = new ObjectId(req.params.id);
    const { products, totalAmount, paidAmount, paymentAccountId, paymentType = null, supplierId } = req.body;
    const newPaid = Number(paidAmount || 0);
    const newTotal = Number(totalAmount || 0);
    const newPaymentDue = newTotal - newPaid;

    const existingPurchase = await purchasesCol.findOne({ _id: purchaseId });
    if (!existingPurchase) return res.status(404).json({ success: false, message: "Purchase not found" });

    // -------------------------
    // 1) Revert old inventory
    // -------------------------
    for (const item of existingPurchase.products || []) {
      const result = await deductFromInventory(item, purchaseId);
      if (!result.success) return res.status(400).json({ success: false, message: `Revert inventory failed: ${result.message}` });
    }

    // -------------------------
    // 2) Adjust payment ledger (MIXED MODEL)
    // - Find old payment details (paid amount & account)
    // - If oldAccount === newAccount -> compute diff and adjust that account
    // - If accounts differ -> return oldPaid to oldAccount (credit) and debit newAccount with newPaid
    // - Update or upsert the invoice transaction document to reflect new payment
    // -------------------------
    const oldPaid = Number(existingPurchase.paidAmount || 0);
    // Resolve old account (existing purchase may have paymentAccountId or legacy paymentType)
    const oldAccount = await resolveAccount({ accountId: existingPurchase.paymentAccountId, paymentType: existingPurchase.paymentType });
    const newAccount = await resolveAccount({ accountId: paymentAccountId, paymentType });

    // Case: both null/undefined means both were due -> nothing to do
    if (oldPaid || newPaid) {
      if (oldPaid && newPaid && oldAccount && newAccount && String(oldAccount._id) === String(newAccount._id)) {
        // Same account - adjust by diff
        const diff = newPaid - oldPaid; // positive => debit more; negative => credit back
        if (diff !== 0) {
          await adjustAccountByDiff({
            account: newAccount,
            invoice_id: purchaseId,
            entry_source: "invoice_update",
            diff,
            particulars: `Purchase update - ${products ? products.map(p => `${p.name} x ${p.qty}`).join(", ") : ""}`,
            details: { products }
          });
        }
        // Update invoice txn document (if exists) to new amount/account
        await upsertInvoicePaymentTransaction({
          invoice_id: purchaseId,
          account: newAccount,
          transaction_type: newPaid > 0 ? "debit" : "credit",
          amount: newPaid,
          particulars: `Purchase updated - ${products ? products.map(p => `${p.name} x ${p.qty}`).join(", ") : ""}`,
          details: { products }
        });
      } else {
        // Accounts differ or one missing: handle separately
        // Return oldPaid to oldAccount (credit) if exists
        if (oldPaid && oldAccount) {
          await adjustAccountByDiff({
            account: oldAccount,
            invoice_id: purchaseId,
            entry_source: "invoice_update_return_old",
            diff: -oldPaid, // negative => credit back
            particulars: `Return old payment for purchase ${purchaseId}`,
            details: { products }
          });
        } else if (oldPaid && !oldAccount) {
          // oldPaid exists but old account not found: still attempt to find transactions and remove or adjust them
          // (no-op for account balance)
        }

        // Debit newAccount with newPaid if exists
        if (newPaid && newAccount) {
          await adjustAccountByDiff({
            account: newAccount,
            invoice_id: purchaseId,
            entry_source: "invoice_update_apply_new",
            diff: newPaid, // positive => debit the new account
            particulars: `Apply new payment for purchase ${purchaseId}`,
            details: { products }
          });
        }

        // Upsert payment transaction for the newAccount with newPaid amount
        if (newAccount) {
          await upsertInvoicePaymentTransaction({
            invoice_id: purchaseId,
            account: newAccount,
            transaction_type: newPaid > 0 ? "debit" : "credit",
            amount: newPaid,
            particulars: `Purchase updated - ${products ? products.map(p => `${p.name} x ${p.qty}`).join(", ") : ""}`,
            details: { products }
          });
        }
      }
    }

    // -------------------------
    // 3) Revert old supplier totals (remove old purchase effects)
    // -------------------------
    if (existingPurchase.supplierId) {
      const supplierObjId = new ObjectId(existingPurchase.supplierId);
      const totalOldPurchase = Number(existingPurchase.totalAmount || 0);
      const totalOldDue = totalOldPurchase - Number(existingPurchase.paidAmount || 0);

      await suppliersCol.updateOne(
        { _id: supplierObjId },
        { $inc: { total_purchase: -totalOldPurchase, total_due: -totalOldDue }, $set: { last_purchase_date: new Date() } }
      );
    }

    // -------------------------
    // 4) Add new inventory (apply new products)
    // -------------------------
    for (const item of products || []) {
      const result = await addToInventory(item, purchaseId);
      if (!result.success) return res.status(400).json({ success: false, message: `Add inventory failed: ${result.message}` });
    }

    // -------------------------
    // 5) Update supplier totals with new purchase
    // -------------------------
    if (supplierId) {
      const supplierObjId = new ObjectId(supplierId);
      const supplierDue = newTotal - newPaid;

      await suppliersCol.updateOne(
        { _id: supplierObjId },
        { $inc: { total_purchase: newTotal, total_due: supplierDue }, $set: { last_purchase_date: new Date() } }
      );

      await suppliersCol.updateOne(
        { _id: supplierObjId },
        {
          $push: {
            supplier_history: {
              date: new Date(),
              type: "updated_purchase",
              purchase_id: purchaseId,
              products,
              total_amount: newTotal,
              paid_amount: newPaid,
              due_after_payment: newPaymentDue,
              remarks: "Purchase updated"
            }
          }
        }
      );
    }

    // -------------------------
    // 6) Update purchase document
    // -------------------------
    await purchasesCol.updateOne(
      { _id: purchaseId },
      {
        $set: {
          products,
          totalAmount: newTotal,
          paidAmount: newPaid,
          payment_due: newPaymentDue,
          paymentAccountId: paymentAccountId || (existingPurchase.paymentAccountId || null),
          paymentType: paymentType || existingPurchase.paymentType || null,
          supplierId: supplierId ? new ObjectId(supplierId) : null,
          date: new Date()
        }
      }
    );

    const updatedPurchase = await purchasesCol.findOne({ _id: purchaseId });

    return res.status(200).json({ success: true, message: "Purchase updated successfully", data: updatedPurchase });
  } catch (err) {
    console.error("updatePurchase failed:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

/* ======================
   CONTROLLER: paySupplierDue (uses unified accounts)
   ====================== */
async function paySupplierDue(req, res) {
  try {
    const purchaseId = new ObjectId(req.params.id);
    // accept either account id or paymentType (legacy)
    const { payAmount, paymentAccountId, paymentMethod = null } = req.body;

    if (!payAmount || payAmount <= 0) return res.status(400).json({ success: false, message: "Invalid payment amount." });

    const purchase = await purchasesCol.findOne({ _id: purchaseId });
    if (!purchase) return res.status(404).json({ success: false, message: "Purchase not found" });

    const oldPaid = Number(purchase.paidAmount || 0);
    const oldTotal = Number(purchase.totalAmount || 0);
    const oldDue = oldTotal - oldPaid;
    if (payAmount > oldDue) return res.status(400).json({ success: false, message: "Payment exceeds due amount" });

    // Resolve account
    const account = await resolveAccount({ accountId: paymentAccountId, paymentType: paymentMethod });
    if (!account) return res.status(404).json({ success: false, message: "Payment account not found" });

    // Debit account (supplier payment) => decrease account by payAmount (debit)
    await adjustAccountByDiff({
      account,
      invoice_id: purchaseId,
      entry_source: "supplier_due_payment",
      diff: Number(payAmount),
      particulars: `Supplier due payment for purchase ${purchaseId}`,
      details: { previousPaid: oldPaid, payAmount }
    });

    // Update supplier totals
    if (purchase.supplierId) {
      const supplierObjId = new ObjectId(purchase.supplierId);
      await suppliersCol.updateOne(
        { _id: supplierObjId },
        {
          $inc: { total_due: -Number(payAmount) },
          $set: { last_payment_date: new Date() }
        }
      );

      // Add supplier history
      await suppliersCol.updateOne(
        { _id: supplierObjId },
        {
          $push: {
            supplier_history: {
              date: new Date(),
              type: "due_payment",
              purchase_id: purchaseId,
              paid_amount: Number(payAmount),
              previous_due: oldDue,
              due_after_payment: oldDue - Number(payAmount),
              payment_method: paymentMethod || account.method || account.type,
              remarks: "Due partially or fully paid"
            }
          }
        }
      );
    }

    // Update purchase payment fields
    const updatedPaid = oldPaid + Number(payAmount);
    const newDue = oldTotal - updatedPaid;
    await purchasesCol.updateOne(
      { _id: purchaseId },
      { $set: { paidAmount: updatedPaid, payment_due: newDue, paymentAccountId: paymentAccountId || null, paymentType: paymentMethod || null, last_payment_date: new Date() } }
    );

    const updatedPurchase = await purchasesCol.findOne({ _id: purchaseId });

    res.status(200).json({ success: true, message: "Supplier due paid successfully", data: updatedPurchase });
  } catch (err) {
    console.error("paySupplierDue failed:", err);
    res.status(500).json({ success: false, error: err.message });
  }
}

/* ======================
   CONTROLLER: deletePurchase
   ====================== */
async function deletePurchase(req, res) {
  try {
    const purchaseId = new ObjectId(req.params.id);
    const existingPurchase = await purchasesCol.findOne({ _id: purchaseId });
    if (!existingPurchase) return res.status(404).json({ success: false, message: "Purchase not found" });

    // Revert inventory
    for (const item of existingPurchase.products || []) {
      await deductFromInventory(item, purchaseId);
    }

    // Revert supplier totals if needed
    if (existingPurchase.supplierId) {
      const supplierObjId = new ObjectId(existingPurchase.supplierId);
      const totalOldPurchase = Number(existingPurchase.totalAmount || 0);
      const totalOldDue = totalOldPurchase - Number(existingPurchase.paidAmount || 0);

      await suppliersCol.updateOne(
        { _id: supplierObjId },
        { $inc: { total_purchase: -totalOldPurchase, total_due: -totalOldDue } }
      );
    }

    // Optionally: remove related transactions for this invoice_id
    await transactionsCol.deleteMany({ invoice_id: purchaseId.toString() });

    // Delete purchase record
    await purchasesCol.deleteOne({ _id: purchaseId });
    res.status(200).json({ success: true, message: "Purchase deleted successfully" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/* ======================
   INVENTORY HELPERS (unchanged)
   ====================== */
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
      const oldAvg = existingItem.average_purchase_price ?? product.purchase_price;

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
    const productId = extractProductId(product.product_id) || product._id;
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

/* ======================
   Export controllers
   ====================== */
module.exports = {
  createPurchase,
  getPurchases,
  getPurchaseById,
  updatePurchase,
  deletePurchase,
  paySupplierDue,
};
