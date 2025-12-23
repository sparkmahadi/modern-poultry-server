const { db } = require("../db");
const { ObjectId } = require("mongodb");

const transactionsCollection = db.collection("transactions");
const accountsCollection = db.collection("payment_accounts");

// CREATE transaction
exports.createTransaction = async (req, res) => {
  try {
    const transaction = req.body;
    console.log('transaction body', transaction);

    if (!transaction.account_id) {
      return res.status(400).json({
        success: false,
        message: "account_id is required"
      });
    }

    // Auto-add date and time if not provided
    const now = new Date();
    transaction.date = transaction.date ? new Date(transaction.date) : now;
    transaction.time = transaction.time || now.toTimeString().split(" ")[0];

    // Get the account balance
    const account = await accountsCollection.findOne({
      _id: new ObjectId(transaction.account_id)
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Account not found"
      });
    }

    const lastBalance = account.balance || 0;
    const amount = transaction.amount || 0;
    console.log(transaction);
    transaction.balance_after_transaction = lastBalance;

    console.log('final form trans', transaction);
    // Insert transaction
    await transactionsCollection.insertOne(transaction);

    res.status(201).json({ success: true, data: transaction });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET all transactions
exports.getTransactions = async (req, res) => {
  try {
    const transactions = await transactionsCollection
      .find()
      .sort({ date: -1, time: -1 })
      .toArray();

    res.status(200).json({ success: true, data: transactions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET single transaction
exports.getTransactionById = async (req, res) => {
  try {
    const transaction = await transactionsCollection.findOne({
      _id: new ObjectId(req.params.id),
    });

    if (!transaction)
      return res
        .status(404)
        .json({ success: false, message: "Transaction not found" });

    res.status(200).json({ success: true, data: transaction });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// REPROCESS balances (per account)
const reProcessBalances = async (account_id) => {
  // 1. Get all transactions for this account only
  const allTransactions = await transactionsCollection
    .find({ account_id })
    .sort({ date: 1, time: 1 })
    .toArray();

  let runningBalance = 0;

  // 2. Iterate and update
  for (const transaction of allTransactions) {
    const amount = transaction.amount || 0;

    if (transaction.transaction_type === "credit") {
      runningBalance += amount;
    } else if (transaction.transaction_type === "debit") {
      runningBalance -= amount;
    }

    runningBalance = Math.round(runningBalance * 100) / 100;

    await transactionsCollection.updateOne(
      { _id: transaction._id },
      { $set: { balance_after_transaction: runningBalance } }
    );
  }

  // 3. Update the account balance
  await accountsCollection.updateOne(
    { _id: new ObjectId(account_id) },
    { $set: { balance: runningBalance } }
  );

  return runningBalance;
};

// UPDATE transaction
exports.updateTransaction = async (req, res) => {
  try {
    const transactionId = req.params.id;

    // Update the transaction (same logic as you wrote)
    const result = await transactionsCollection.updateOne(
      { _id: new ObjectId(transactionId) },
      { $set: req.body }
    );

    if (result.matchedCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Transaction not found" });
    }

    // Get the updated transaction to know account_id
    const updatedTxn = await transactionsCollection.findOne({
      _id: new ObjectId(transactionId),
    });

    // Rebalance only for that account
    const finalBalance = await reProcessBalances(updatedTxn.account_id);

    res.status(200).json({
      success: true,
      message: "Transaction updated and ledger re-balanced successfully.",
      new_balance: finalBalance,
    });
  } catch (error) {
    console.error("Error during transaction update:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE transaction
exports.deleteTransaction = async (req, res) => {
  try {
    // Fetch transaction first to know account_id
    const txn = await transactionsCollection.findOne({
      _id: new ObjectId(req.params.id),
    });

    if (!txn) {
      return res
        .status(404)
        .json({ success: false, message: "Transaction not found" });
    }

    // Delete it
    await transactionsCollection.deleteOne({
      _id: new ObjectId(req.params.id),
    });

    // Recalculate balance for that account
    await reProcessBalances(txn.account_id);

    res.status(200).json({
      success: true,
      message: "Transaction deleted and ledger rebalanced.",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
