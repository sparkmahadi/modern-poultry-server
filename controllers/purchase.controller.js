const { ObjectId } = require("mongodb");
const { addToInventory, deductFromInventory, decreaseCash } = require("../utils/cashAndInventory.js");
const { db } = require("../db.js");

const purchasesCol = db.collection("purchases");
const transactionsCol = db.collection("transactions");
const cashCol = db.collection("cash");

// CREATE Purchase (already provided)
async function createPurchase(req, res) {
  const { products, totalAmount, paymentType = "cash", paidAmount = 0, supplierId } = req.body;
console.log(req.body);
  if (!products || products.length === 0) {
    return res.status(400).json({ success: false, error: "No products provided" });
  }

  const invoiceId = new ObjectId();
  const purchaseDate = new Date();

  try {
    // 1️⃣ Add products to inventory
    // for (const item of products) {
    //   await addToInventory(item, invoiceId);
    // }

    // 2️⃣ Handle cash and supplier due
    let supplierDue = 0;
    const cashAccount = await cashCol.findOne({});
    const lastBalance = cashAccount?.current_balance || 0;
    let newBalance = lastBalance;

    if (paymentType === "cash") {
      newBalance = lastBalance - totalAmount;
      await transactionsCol.insertOne({
        date: purchaseDate,
        time: purchaseDate.toTimeString().split(" ")[0],
        entry_source: "invoice",
        invoice_id: invoiceId.toString(),
        transaction_type: "debit",
        particulars: `Purchase - ${products.map((p) => `${p.name} x ${p.qty}`).join(", ")}`,
        products,
        amount: totalAmount,
        balance_after_transaction: newBalance,
        payment_details: { paidAmount: totalAmount, supplierDue: 0, paymentType },
        created_by: "admin",
      });
    } else if (paymentType === "partial") {
      newBalance = lastBalance - paidAmount;
      supplierDue = totalAmount - paidAmount;
      await transactionsCol.insertOne({
        date: purchaseDate,
        time: purchaseDate.toTimeString().split(" ")[0],
        entry_source: "purchase_invoice",
        invoice_id: invoiceId.toString(),
        transaction_type: "debit",
        particulars: `Purchase - ${products.map((p) => `${p.name} x ${p.qty}`).join(", ")}`,
        products,
        amount: paidAmount,
        balance_after_transaction: newBalance,
        payment_details: { paidAmount, supplierDue, paymentType },
        created_by: "admin",
        remarks: "Auto entry from purchase invoice",
      });
    } else if (paymentType === "debt") {
      supplierDue = totalAmount;
    } else {
      return res.status(400).json({ success: false, error: "Invalid payment type" });
    }

    // 3️⃣ Update cash balance if applicable
    if (paymentType === "cash" || paymentType === "partial") {
      await cashCol.updateOne({}, { $set: { current_balance: newBalance } }, { upsert: true });
    }

    // 4️⃣ Save purchase
    await purchasesCol.insertOne({
      _id: invoiceId,
      supplierId: supplierId ? new ObjectId(supplierId) : null,
      products,
      totalAmount,
      paidAmount,
      supplierDue,
      paymentType,
      date: purchaseDate,
    });

    res.status(201).json({ success: true, message: "Purchase recorded", invoiceId, newCashBalance: newBalance });
  } catch (err) {
    console.error(err);
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
