const { ObjectId } = require("mongodb");
const { addToInventory, decreaseCash } = require("../utils/cashAndInventory.js");
const {db} = require("../db.js");

// Create a purchase invoice
// async function createPurchase(req, res) {
//   const { products, totalAmount, paymentType, paidAmount = 0, supplierId } = req.body;

//   if (!products || products.length === 0) {
//     return res.status(400).json({ success: false, error: "No products provided" });
//   }

//   const invoiceId = new ObjectId();
//   const purchaseDate = new Date();

//   try {
//     // Validate products & update inventory
//     // for (const item of products) {
//     //   const { productId, qty } = item;

//     //   let product = await db.collection("inventory").findOne({ _id: new ObjectId(productId) });
//     //   if (!product) {
//     //     const newProduct = {
//     //       _id: new ObjectId(productId),
//     //       name: item.name || "Unnamed Product",
//     //       stock_qty: 0
//     //     };
//     //     await db.collection("inventory").insertOne(newProduct);
//     //   }

//     //   await addToInventory(productId, qty, "Purchase", invoiceId.toString());
//     // }

//     // Handle payment
//     let supplierDue = 0;
//     // if (paymentType === "paid") {
//     //   await decreaseCash(totalAmount, "purchase", invoiceId.toString());
//     // } else if (paymentType === "partial") {
//     //   await decreaseCash(paidAmount, "purchase", invoiceId.toString());
//     //   supplierDue = totalAmount - paidAmount;
//     // } else if (paymentType === "debt") {
//     //   supplierDue = totalAmount;
//     // } else {
//     //   return res.status(400).json({ success: false, error: "Invalid payment type" });
//     // }

//     // Record purchase invoice
//     await db.collection("purchases").insertOne({
//       _id: invoiceId,
//       supplierId: supplierId ? new ObjectId(supplierId) : null,
//       products,
//       totalAmount,
//       paidAmount,
//       supplierDue,
//       paymentType,
//       date: purchaseDate
//     });

//     // Record ledger entry
//     // await db.collection("ledger").insertOne({
//     //   invoiceId: invoiceId.toString(),
//     //   type: "purchase",
//     //   totalAmount,
//     //   paidAmount,
//     //   supplierDue,
//     //   date: purchaseDate
//     // });

//     res.status(201).json({ success: true, message: "Purchase recorded", invoiceId });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ success: false, error: err.message });
//   }
// }





async function createPurchase(req, res) {
  const { products, totalAmount, paymentType = "cash", paidAmount = 0, supplierId } = req.body;
  console.log(req.body);

  if (!products || products.length === 0) {
    return res.status(400).json({ success: false, error: "No products provided" });
  }

  const invoiceId = new ObjectId();
  const purchaseDate = new Date();

  try {
    const purchasesCol = db.collection("purchases");
    const transactionsCol = db.collection("transactions");
    const cashCol = db.collection("cash");

    // 1️⃣ Update inventory (if needed)
    // for (const item of products) {
    //   await addToInventory(item.product_id, item.qty, "Purchase", invoiceId.toString());
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
        time: purchaseDate.toTimeString().split(' ')[0],
        entry_source: "purchase_invoice",
        invoice_id: invoiceId.toString(),
        transaction_type: "debit",
        particulars: `Purchase - ${products.map(p => `${p.name} x ${p.qty}`).join(', ')}`,
        products,
        amount: totalAmount,
        balance_after_transaction: newBalance,
        payment_details: {
          paidAmount: totalAmount,
          supplierDue: 0,
          paymentType
        },
        created_by: "admin",
        remarks: "Auto entry from purchase invoice"
      });
    } else if (paymentType === "partial") {
      newBalance = lastBalance - paidAmount;
      supplierDue = totalAmount - paidAmount;

      await transactionsCol.insertOne({
        date: purchaseDate,
        time: purchaseDate.toTimeString().split(' ')[0],
        entry_source: "purchase_invoice",
        invoice_id: invoiceId.toString(),
        transaction_type: "debit",
        particulars: `Purchase - ${products.map(p => `${p.name} x ${p.qty}`).join(', ')}`,
        products,
        amount: paidAmount,
        balance_after_transaction: newBalance,
        payment_details: {
          paidAmount,
          supplierDue,
          paymentType
        },
        created_by: "admin",
        remarks: "Auto entry from purchase invoice"
      });
    } else if (paymentType === "debt") {
      supplierDue = totalAmount;
      // No cash transaction needed
    } else {
      return res.status(400).json({ success: false, error: "Invalid payment type" });
    }

    // Update cash account if cash was paid
    if (paymentType === "paid" || paymentType === "partial") {
      await cashCol.updateOne({}, { $set: { current_balance: newBalance } }, { upsert: true });
    }

    // 3️⃣ Record purchase invoice
    await purchasesCol.insertOne({
      _id: invoiceId,
      supplierId: supplierId ? new ObjectId(supplierId) : null,
      products,
      totalAmount,
      paidAmount,
      supplierDue,
      paymentType,
      date: purchaseDate
    });

    res.status(201).json({ success: true, message: "Purchase recorded", invoiceId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
}





module.exports = { createPurchase };
