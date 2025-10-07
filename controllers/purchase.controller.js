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
    const supplierDue = total_amount - paidAmount;

    const purchaseData = {
      _id: invoiceId,
      supplierId: supplierId ? new ObjectId(supplierId) : null,
      products,
      totalAmount: total_amount,
      paidAmount,
      supplierDue,
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
        payment_details: { paidAmount, supplierDue, paymentType },
        created_by: "admin",
      };

      await transactionsCol.insertOne(transactionData);
      rollbackOps.push(() => transactionsCol.deleteOne({ invoice_id: invoiceId.toString() }));

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
          $inc: { total_purchase: total_amount, total_due: supplierDue },
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
  try {
    const purchase = await purchasesCol.findOne({ _id: new ObjectId(req.params.id) });
    if (!purchase) return res.status(404).json({ success: false, message: "Purchase not found" });
    res.status(200).json({ success: true, data: purchase });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// UPDATE purchase
async function updatePurchase(req, res) {
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
