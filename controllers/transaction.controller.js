const { db } = require("../db");
const { ObjectId } = require("mongodb");

const transactionsCollection = db.collection("transactions");
const cashCollection = db.collection("cash");

// CREATE transaction
exports.createTransaction = async (req, res) => {
  try {
    const transaction = req.body;

    // Auto-add date and time if not provided
    const now = new Date();
    transaction.date = transaction.date ? new Date(transaction.date) : now;
    transaction.time = transaction.time || now.toTimeString().split(" ")[0];

    // Get current cash balance
    const cashAccount = await cashCollection.findOne({}); // assuming single account
    const lastBalance = cashAccount?.current_balance || 0;

    const amount = transaction.amount || 0;
    if (transaction.transaction_type === "credit") {
      transaction.balance_after_transaction = lastBalance + amount;
    } else if (transaction.transaction_type === "debit") {
      transaction.balance_after_transaction = lastBalance - amount;
    } else {
      return res
        .status(400)
        .json({ success: false, message: "Invalid transaction type" });
    }

    // Insert transaction
    const result = await transactionsCollection.insertOne(transaction);

    // Update cash balance
    await cashCollection.updateOne(
      {},
      { $set: { current_balance: transaction.balance_after_transaction } },
      { upsert: true }
    );

    res.status(201).json({ success: true, data: transaction });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET all transactions (sorted by date & time descending)
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
    const transaction = await transactionsCollection.findOne({
      _id: new ObjectId(req.params.id),
    });
    if (!transaction)
      return res.status(404).json({ success: false, message: "Transaction not found" });

    res.status(200).json({ success: true, data: transaction });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Function to re-calculate and update the balance for all subsequent transactions
const reProcessBalances = async () => {
    // 1. Get ALL transactions, sorted chronologically
    const allTransactions = await transactionsCollection
        .find()
        .sort({ date: 1, time: 1 }) // Sort ascending: oldest first
        .toArray();

    let runningBalance = 0;

    // 2. Iterate and update
    for (const transaction of allTransactions) {
        const amount = transaction.amount || 0;
        
        // Calculate new balance
        if (transaction.transaction_type === "credit") {
            runningBalance += amount;
        } else if (transaction.transaction_type === "debit") {
            runningBalance -= amount;
        }

        // Rounding for safe monetary representation (optional, but recommended)
        runningBalance = Math.round(runningBalance * 100) / 100;
        
        // Update the transaction's balance_after_transaction field
        await transactionsCollection.updateOne(
            { _id: transaction._id },
            { $set: { balance_after_transaction: runningBalance } }
        );
    }
    
    // 3. Update the final cash balance
    await cashCollection.updateOne(
        {},
        { $set: { current_balance: runningBalance } },
        { upsert: true }
    );
    
    return runningBalance;
};


// UPDATE transaction (FIXED LOGIC)
exports.updateTransaction = async (req, res) => {
    try {
        const transactionId = req.params.id;
        const updateData = req.body;
        
        // 1. Update the specific transaction document with new data (e.g., particulars, amount)
        const result = await transactionsCollection.updateOne(
            { _id: new ObjectId(transactionId) },
            { $set: updateData }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, message: "Transaction not found" });
        }
        
        // 2. Re-calculate and update the balances for the entire ledger
        const finalBalance = await reProcessBalances();

        res.status(200).json({ 
            success: true, 
            message: "Transaction updated and ledger re-balanced successfully.",
            new_cash_balance: finalBalance
        });
    } catch (error) {
        // Since re-processing is critical, any error here must be reported
        console.error("Error during transaction update and re-balancing:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// DELETE transaction
exports.deleteTransaction = async (req, res) => {
  try {
    const result = await transactionsCollection.deleteOne({
      _id: new ObjectId(req.params.id),
    });
    if (result.deletedCount === 0)
      return res.status(404).json({ success: false, message: "Transaction not found" });

    res.status(200).json({ success: true, message: "Transaction deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};



































// const {db} = require("../db");

//     const transactionsCollection = db.collection('transactions');
//     const cashCollection = db.collection('cash');

// // CREATE transaction
// exports.createTransaction = async (req, res) => {
//   try {
//     const transaction = req.body;

//     // Get current cash balance
//     const cashAccount = await cashCollection.findOne({}); // assuming single account
//     let lastBalance = cashAccount?.current_balance || 0;

//     // Calculate new balance
//     const amount = transaction.amount || 0;
//     if (transaction.transaction_type === 'credit') {
//       transaction.balance_after_transaction = lastBalance + amount;
//     } else if (transaction.transaction_type === 'debit') {
//       transaction.balance_after_transaction = lastBalance - amount;
//     } else {
//       return res.status(400).json({ success: false, message: 'Invalid transaction type' });
//     }

//     // Insert transaction
//     await transactionsCollection.insertOne(transaction);

//     // Update cash balance
//     await cashCollection.updateOne({}, { $set: { current_balance: transaction.balance_after_transaction } }, { upsert: true });

//     res.status(201).json({ success: true, data: transaction });
//   } catch (error) {
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

// // GET all transactions
// exports.getTransactions = async (req, res) => {
//   try {
//     const transactions = await transactionsCollection
//       .find()
//       .sort({ date: -1, time: -1 })
//       .toArray();
//     res.status(200).json({ success: true, data: transactions });
//   } catch (error) {
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

// // GET single transaction by _id
// exports.getTransactionById = async (req, res) => {
//   try {
//     const transaction = await transactionsCollection.findOne({ _id: new require('mongodb').ObjectId(req.params.id) });
//     if (!transaction) return res.status(404).json({ success: false, message: 'Transaction not found' });
//     res.status(200).json({ success: true, data: transaction });
//   } catch (error) {
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

// // UPDATE transaction
// exports.updateTransaction = async (req, res) => {
//   try {
//     const result = await transactionsCollection.updateOne(
//       { _id: new require('mongodb').ObjectId(req.params.id) },
//       { $set: req.body }
//     );
//     if (result.matchedCount === 0) return res.status(404).json({ success: false, message: 'Transaction not found' });
//     res.status(200).json({ success: true, message: 'Transaction updated' });
//   } catch (error) {
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

// // DELETE transaction
// exports.deleteTransaction = async (req, res) => {
//   try {
//     const result = await transactionsCollection.deleteOne({ _id: new require('mongodb').ObjectId(req.params.id) });
//     if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Transaction not found' });
//     res.status(200).json({ success: true, message: 'Transaction deleted' });
//   } catch (error) {
//     res.status(500).json({ success: false, message: error.message });
//   }
// };
