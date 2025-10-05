const { ObjectId } = require("mongodb");
const { subtractFromInventory, increaseCash } = require("../utils/cashAndInventory.js");
const { updateCustomerBalance } = require("../utils/customerService.js");
const { db } = require("../db.js");

const salesCollection = db.collection("sales")

// module.exports.createSell = async (req, res) => {
//   console.log('hit createsell');
//   const { memoNo, date, customer, products, total, paidAmount, due } = req.body;
//   console.log(customer);
//   if (!products || products.length === 0) {
//     return res.status(400).json({ success: false, error: "No products provided" });
//   }

//   if (!customer || !customer.name) {
//     return res.status(400).json({ success: false, error: "Customer information required" });
//   }

//   const memoId = new ObjectId();
//   const sellDate = date ? new Date(date) : new Date();

//   try {
//     // 2️⃣ Subtract sold quantity from inventory
//     // for (const item of products) {
//     //   await subtractFromInventory(item._id, item.qty, "Sale", memoId.toString());
//     // }

//     // 3️⃣ Update cash with paid amount
//     if (paidAmount && paidAmount > 0) {
//       await increaseCash(paidAmount, "Sale", memoId.toString());
//     }

//     // 4️⃣ Update customer balance (due or advance)
//     // await updateCustomerBalance(customerData._id, due);

//     // 5️⃣ Record sell memo
//     const result = await salesCollection.insertOne({
//       _id: memoId,
//       memoNo,
//       date: sellDate,
//       customerId: customer._id,
//       customerName: customer.name,
//       products,
//       total,
//       paidAmount,
//       due,
//       createdAt: new Date(),
//     });

//     // 6️⃣ Record ledger entry
//     // await db.collection("ledger").insertOne({
//     //   memoId: memoId.toString(),
//     //   type: "sale",
//     //   totalAmount: total,
//     //   paidAmount,
//     //   due,
//     //   customerId: customerData._id,
//     //   date: sellDate,
//     // });

//     if (result.acknowledged) {
//       res.status(201).json({
//         success: true,
//         message: "Sell memo created successfully",
//         memoId,
//       });
//     } else {
//       res.send({ success: false, message: "Not inserted" })
//     }
//   } catch (err) {
//     console.error("❌ Error creating sell memo:", err);
//     res.status(500).json({ success: false, error: err.message });
//   }
// };





module.exports.createSell = async (req, res) => {
  console.log('hit createsell');
  const { memoNo, date, customer, products, total, paidAmount, due } = req.body;

  if (!products || products.length === 0) {
    return res.status(400).json({ success: false, error: "No products provided" });
  }

  if (!customer || !customer.name) {
    return res.status(400).json({ success: false, error: "Customer information required" });
  }

  const memoId = new ObjectId();
  const sellDate = date ? new Date(date) : new Date();

  try {
    const salesCollection = db.collection("sales");
    const transactionsCol = db.collection("transactions");
    const cashCol = db.collection("cash");

    // 1️⃣ Update inventory (if needed)
    // for (const item of products) {
    //   await subtractFromInventory(item._id, item.qty, "Sale", memoId.toString());
    // }

    // 2️⃣ Get current cash balance
    const cashAccount = await cashCol.findOne({});
    const lastBalance = cashAccount?.current_balance || 0;

    // 3️⃣ Record cash transaction if paidAmount > 0
    let newBalance = lastBalance;
    if (paidAmount && paidAmount > 0) {
      newBalance = lastBalance + paidAmount;

      await transactionsCol.insertOne({
        date: sellDate,
        time: sellDate.toTimeString().split(' ')[0],
        entry_source: "sale_memo",
        memo_id: memoId.toString(),
        transaction_type: "credit",
        particulars: `Sale - ${products.map(p => `${p.item_name} x ${p.qty}`).join(', ')}`,
        products,
        amount: paidAmount,
        balance_after_transaction: newBalance,
        payment_details: {
          paidAmount,
          due,
          paymentType: "cash"
        },
        created_by: "admin", // change as needed
        remarks: "Auto entry from sale memo"
      });

      // Update cash account
      await cashCol.updateOne({}, { $set: { current_balance: newBalance } }, { upsert: true });
    }

    // 4️⃣ Record sell memo
    const result = await salesCollection.insertOne({
      _id: memoId,
      memoNo,
      date: sellDate,
      customerId: customer._id,
      customerName: customer.name,
      products,
      total,
      paidAmount,
      due,
      createdAt: new Date()
    });

    res.status(201).json({
      success: true,
      message: "Sell memo created successfully",
      memoId
    });
  } catch (err) {
    console.error("❌ Error creating sell memo:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};


module.exports.getSales = async (req, res) => {
  try {
    const sales = await salesCollection.find({}).toArray();
    res.status(200).json({ success: true, data: sales });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}