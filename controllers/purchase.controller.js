const { ObjectId } = require("mongodb");
const { addToInventory, decreaseCash } = require("../utils/cashAndInventory.js");
const {db} = require("../db.js");

// Create a purchase invoice
async function createPurchase(req, res) {
  const { products, totalAmount, paymentType, paidAmount = 0, supplierId } = req.body;

  if (!products || products.length === 0) {
    return res.status(400).json({ success: false, error: "No products provided" });
  }

  const invoiceId = new ObjectId();
  const purchaseDate = new Date();

  try {
    // Validate products & update inventory
    for (const item of products) {
      const { productId, qty } = item;

      let product = await db.collection("inventory").findOne({ _id: new ObjectId(productId) });
      if (!product) {
        const newProduct = {
          _id: new ObjectId(productId),
          name: item.name || "Unnamed Product",
          stock_qty: 0
        };
        await db.collection("inventory").insertOne(newProduct);
      }

      await addToInventory(productId, qty, "Purchase", invoiceId.toString());
    }

    // Handle payment
    let supplierDue = 0;
    if (paymentType === "paid") {
      await decreaseCash(totalAmount, "purchase", invoiceId.toString());
    } else if (paymentType === "partial") {
      await decreaseCash(paidAmount, "purchase", invoiceId.toString());
      supplierDue = totalAmount - paidAmount;
    } else if (paymentType === "debt") {
      supplierDue = totalAmount;
    } else {
      return res.status(400).json({ success: false, error: "Invalid payment type" });
    }

    // Record purchase invoice
    await db.collection("purchases").insertOne({
      _id: invoiceId,
      supplierId: supplierId ? new ObjectId(supplierId) : null,
      products,
      totalAmount,
      paidAmount,
      supplierDue,
      paymentType,
      date: purchaseDate
    });

    // Record ledger entry
    await db.collection("ledger").insertOne({
      invoiceId: invoiceId.toString(),
      type: "purchase",
      totalAmount,
      paidAmount,
      supplierDue,
      date: purchaseDate
    });

    res.status(201).json({ success: true, message: "Purchase recorded", invoiceId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { createPurchase };
