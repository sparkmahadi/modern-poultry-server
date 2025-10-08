const { ObjectId } = require("mongodb");
const { addToInventory, deductFromInventory, decreaseCash } = require("../utils/cashAndInventory.js");
const { db } = require("../db.js");

const purchasesCol = db.collection("purchases");
const transactionsCol = db.collection("transactions");
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
      await addToInventory(product, invoiceId);
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

module.exports = {
  createPurchase,
  getPurchases,
  getPurchaseById,
  updatePurchase,
  deletePurchase,
};
