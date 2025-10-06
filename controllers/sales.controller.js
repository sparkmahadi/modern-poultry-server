const { ObjectId } = require("mongodb");
const { subtractFromInventory, increaseCash, deductFromInventory } = require("../utils/cashAndInventory.js");
const { updateCustomerBalance } = require("../utils/customerService.js");
const { db } = require("../db.js");

const salesCollection = db.collection("sales")

// module.exports.createSell = async (req, res) => {
//   console.log('hit createsell');
//   const { memoNo, date, customer, products, total, paidAmount, due } = req.body;

//   if (!products || products.length === 0) {
//     return res.status(400).json({ success: false, error: "No products provided" });
//   }

//   if (!customer || !customer.name) {
//     return res.status(400).json({ success: false, error: "Customer information required" });
//   }

//   const memoId = new ObjectId();
//   const sellDate = date ? new Date(date) : new Date();

//   try {
//     const salesCollection = db.collection("sales");
//     const transactionsCol = db.collection("transactions");
//     const cashCol = db.collection("cash");

//     // 1️⃣ Update inventory (if needed)
//     // for (const item of products) {
//     //   await subtractFromInventory(item._id, item.qty, "Sale", memoId.toString());
//     // }

//     // 2️⃣ Get current cash balance
//     const cashAccount = await cashCol.findOne({});
//     const lastBalance = cashAccount?.current_balance || 0;

//     // 3️⃣ Record cash transaction if paidAmount > 0
//     let newBalance = lastBalance;
//     if (paidAmount && paidAmount > 0) {
//       newBalance = lastBalance + paidAmount;

//       await transactionsCol.insertOne({
//         date: sellDate,
//         time: sellDate.toTimeString().split(' ')[0],
//         entry_source: "sale_memo",
//         memo_id: memoId.toString(),
//         transaction_type: "credit",
//         particulars: `Sale - ${products.map(p => `${p.item_name} x ${p.qty}`).join(', ')}`,
//         products,
//         amount: paidAmount,
//         balance_after_transaction: newBalance,
//         payment_details: {
//           paidAmount,
//           due,
//           paymentType: "cash"
//         },
//         created_by: "admin", // change as needed
//         remarks: "Auto entry from sale memo"
//       });

//       // Update cash account
//       await cashCol.updateOne({}, { $set: { current_balance: newBalance } }, { upsert: true });
//     }

//     // 4️⃣ Record sell memo
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
//       createdAt: new Date()
//     });

//     res.status(201).json({
//       success: true,
//       message: "Sell memo created successfully",
//       memoId
//     });
//   } catch (err) {
//     console.error("❌ Error creating sell memo:", err);
//     res.status(500).json({ success: false, error: err.message });
//   }
// };

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

  try {
    const salesCol = db.collection("sales");
    const transactionsCol = db.collection("transactions");
    const cashCol = db.collection("cash");

    // 1️⃣ Deduct sold quantity from inventory
    for (const item of products) {
      await deductFromInventory(item, memoId.toString());
    }

    // 2️⃣ Get current cash balance
    const cashAccount = await cashCol.findOne({});
    const lastBalance = cashAccount?.current_balance || 0;
    let newBalance = lastBalance;

    // 3️⃣ Record cash transaction if paid
    if (paidAmount && paidAmount > 0) {
      newBalance = lastBalance + paidAmount;

      await transactionsCol.insertOne({
        date: sellDate,
        time: sellDate.toTimeString().split(" ")[0],
        entry_source: "sale_memo",
        memo_id: memoId.toString(),
        transaction_type: "credit",
        particulars: `Sale - ${products.map(p => `${p.item_name} x ${p.qty}`).join(", ")}`,
        products,
        amount: paidAmount,
        balance_after_transaction: newBalance,
        payment_details: {
          paidAmount,
          due,
          paymentType: "cash"
        },
        created_by: "admin",
        remarks: "Auto entry from sale memo"
      });

      // 4️⃣ Update cash balance
      await cashCol.updateOne({}, { $set: { current_balance: newBalance } }, { upsert: true });
    }

    // 5️⃣ Record the sale memo
    const result = await salesCol.insertOne({
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

    if (result.acknowledged) {
      res.status(201).json({
        success: true,
        message: "Sell memo created successfully",
        memoId
      });
    } else {
      res.status(400).json({ success: false, message: "Failed to record sale memo" });
    }

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