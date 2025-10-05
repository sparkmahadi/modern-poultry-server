const {db} = require("../db");

    const transactionsCollection = db.collection('transactions');
    const cashCollection = db.collection('cash');

// CREATE transaction
exports.createTransaction = async (req, res) => {
  try {
    const transaction = req.body;

    // Get current cash balance
    const cashAccount = await cashCollection.findOne({}); // assuming single account
    let lastBalance = cashAccount?.current_balance || 0;

    // Calculate new balance
    const amount = transaction.amount || 0;
    if (transaction.transaction_type === 'credit') {
      transaction.balance_after_transaction = lastBalance + amount;
    } else if (transaction.transaction_type === 'debit') {
      transaction.balance_after_transaction = lastBalance - amount;
    } else {
      return res.status(400).json({ success: false, message: 'Invalid transaction type' });
    }

    // Insert transaction
    await transactionsCollection.insertOne(transaction);

    // Update cash balance
    await cashCollection.updateOne({}, { $set: { current_balance: transaction.balance_after_transaction } }, { upsert: true });

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

// GET single transaction by _id
exports.getTransactionById = async (req, res) => {
  try {
    const transaction = await transactionsCollection.findOne({ _id: new require('mongodb').ObjectId(req.params.id) });
    if (!transaction) return res.status(404).json({ success: false, message: 'Transaction not found' });
    res.status(200).json({ success: true, data: transaction });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// UPDATE transaction
exports.updateTransaction = async (req, res) => {
  try {
    const result = await transactionsCollection.updateOne(
      { _id: new require('mongodb').ObjectId(req.params.id) },
      { $set: req.body }
    );
    if (result.matchedCount === 0) return res.status(404).json({ success: false, message: 'Transaction not found' });
    res.status(200).json({ success: true, message: 'Transaction updated' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE transaction
exports.deleteTransaction = async (req, res) => {
  try {
    const result = await transactionsCollection.deleteOne({ _id: new require('mongodb').ObjectId(req.params.id) });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Transaction not found' });
    res.status(200).json({ success: true, message: 'Transaction deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
