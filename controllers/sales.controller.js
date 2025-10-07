const { ObjectId } = require("mongodb");
const { subtractFromInventory, increaseCash, deductFromInventory, addToInventory } = require("../utils/cashAndInventory.js");
const { updateCustomerBalance } = require("../utils/customerService.js");
const { db } = require("../db.js");

const salesCol = db.collection("sales");
const transactionsCol = db.collection("transactions");
const cashCol = db.collection("cash");
const customersCol = db.collection("customers");


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

  // To track all steps for manual rollback if any step fails
  const rollbackOps = [];

  try {
    // STEP 1️⃣: Deduct sold quantities from inventory
    for (const item of products) {
      await deductFromInventory(item, memoId.toString());
    }
    rollbackOps.push(async () => {
      // Optional: add a reverse function if your inventory logic supports adding back
      for (const item of products) {
        await addToInventory(item, memoId.toString());
      }
    });

    // STEP 2️⃣: Get current cash balance
    const cashAccount = await cashCol.findOne({});
    const lastBalance = cashAccount?.current_balance || 0;
    let newBalance = lastBalance;

    // STEP 3️⃣: Record transaction (only if some cash was received)
    if (paidAmount > 0) {
      newBalance = lastBalance + paidAmount;

      const transactionData = {
        date: sellDate,
        time: sellDate.toTimeString().split(" ")[0],
        entry_source: "sale_memo",
        memo_id: memoId.toString(),
        transaction_type: "credit",
        particulars: `Sale - ${products.map(p => `${p.item_name} x ${p.qty}`).join(", ")}`,
        products,
        amount: paidAmount,
        balance_after_transaction: newBalance,
        payment_details: { paidAmount, due, paymentType: "cash" },
        created_by: "admin",
        remarks: "Auto entry from sale memo"
      };

      await transactionsCol.insertOne(transactionData);
      rollbackOps.push(() => transactionsCol.deleteOne({ memo_id: memoId.toString() }));

      await cashCol.updateOne({}, { $set: { current_balance: newBalance } }, { upsert: true });
      rollbackOps.push(() => cashCol.updateOne({}, { $set: { current_balance: lastBalance } }));
    }

    // STEP 4️⃣: Record the sale memo
    const saleData = {
      _id: memoId,
      memoNo,
      date: sellDate,
      customerId: new ObjectId(customer._id),
      customerName: customer.name,
      products,
      total,
      paidAmount,
      due,
      createdAt: new Date()
    };

    await salesCol.insertOne(saleData);
    rollbackOps.push(() => salesCol.deleteOne({ _id: memoId }));

    // STEP 5️⃣: Update Customer Profile
    const purchasedProductNames = products.map((p) => p.item_name);

    await customersCol.updateOne(
      { _id: new ObjectId(customer._id) },
      {
        $set: { last_purchase_date: sellDate },
        $inc: { total_sales: total, total_due: due * 1 },
        $addToSet: { purchased_products: { $each: purchasedProductNames } },
      },
      { upsert: false }
    );

    // STEP 6️⃣: (Optional) Update reports
    // await reportsCol.updateOne(...)

    // ✅ Success
    res.status(201).json({
      success: true,
      message: "Sell memo created successfully",
      memoId,
      newCashBalance: newBalance
    });

  } catch (err) {
    console.error("❌ Error creating sell memo:", err);

    // 🔁 Rollback previous successful steps in reverse order
    for (const undo of rollbackOps.reverse()) {
      try {
        await undo();
      } catch (rollbackError) {
        console.error("Rollback step failed:", rollbackError);
      }
    }

    res.status(500).json({ success: false, error: err.message });
  }
};



module.exports.getSales = async (req, res) => {
  try {
    const sales = await salesCol.find({}).toArray();
    res.status(200).json({ success: true, data: sales });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}