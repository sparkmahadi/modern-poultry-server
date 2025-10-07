const { ObjectId } = require("mongodb");
const {db} = require("../db");

// 🏦 Get all cash accounts (already provided)
exports.getCash = async (req, res) => {
  console.log("hit getCash");
  try {
    const cash = await db.collection("cash").find({}).toArray();
    res.status(200).json({ success: true, data: cash });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ➕ Add cash (deposit)
exports.addCash = async (req, res) => {
  try {
    const { amount, remarks = "Cash deposit", created_by = "admin" } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: "Invalid amount" });
    }

    const cashCol = db.collection("cash");
    const transactionsCol = db.collection("transactions");

    // 1️⃣ Get current cash account (assuming single main account)
    let cashAccount = await cashCol.findOne({});
    if (!cashAccount) {
      // Create default cash account if not exists
      cashAccount = {
        _id: "cash_001",
        name: "Main Cash Account",
        currency: "BDT",
        balance: 0,
        last_updated: new Date(),
        remarks: "Main farm cash account"
      };
      await cashCol.insertOne(cashAccount);
    }

    // 2️⃣ Update balance
    const newBalance = (cashAccount.balance || 0) + amount;

    await cashCol.updateOne(
      { _id: cashAccount._id },
      { $set: { balance: newBalance, last_updated: new Date() } }
    );

    // 3️⃣ Record transaction
    await transactionsCol.insertOne({
      date: new Date(),
      time: new Date().toTimeString().split(" ")[0],
      entry_source: "manual_deposit",
      transaction_type: "credit",
      particulars: remarks,
      amount,
      balance_after_transaction: newBalance,
      created_by
    });

    res.status(200).json({ success: true, message: "Cash added successfully", new_balance: newBalance });

  } catch (err) {
    console.error("❌ Error adding cash:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ➖ Withdraw cash
exports.withdrawCash = async (req, res) => {
  try {
    const { amount, remarks = "Cash withdrawal", created_by = "admin" } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: "Invalid amount" });
    }

    const cashCol = db.collection("cash");
    const transactionsCol = db.collection("transactions");

    // 1️⃣ Get current cash account
    const cashAccount = await cashCol.findOne({});
    if (!cashAccount) {
      return res.status(400).json({ success: false, message: "No cash account found" });
    }

    const currentBalance = cashAccount.balance || 0;

    if (amount > currentBalance) {
      return res.status(400).json({ success: false, message: "Insufficient cash balance" });
    }

    const newBalance = currentBalance - amount;

    // 2️⃣ Update balance
    await cashCol.updateOne(
      { _id: cashAccount._id },
      { $set: { balance: newBalance, balance: newBalance, last_updated: new Date() } }
    );

    // 3️⃣ Record transaction
    await transactionsCol.insertOne({
      date: new Date(),
      time: new Date().toTimeString().split(" ")[0],
      entry_source: "manual_withdrawal",
      transaction_type: "debit",
      particulars: remarks,
      amount,
      balance_after_transaction: newBalance,
      created_by
    });

    res.status(200).json({ success: true, message: "Cash withdrawn successfully", new_balance: newBalance });

  } catch (err) {
    console.error("❌ Error withdrawing cash:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};
