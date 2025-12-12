const { ObjectId } = require("mongodb");
const { db } = require("../db"); // <-- DB connection

const accountsCol = db.collection("payment_accounts");
const transactionsCol = db.collection("transactions");

// ---------------------------------------------
// CREATE ACCOUNT
// ---------------------------------------------
exports.createAccount = async (req, res) => {
  try {
    const { type, method, name, balance, bank_name, account_number, routing_number, branch_name, number, owner_name } = req.body;

    if (!type) return res.status(400).json({ success: false, message: "Account type is required" });

    // Type-specific validations
    let doc = { type, balance: Number(balance) || 0, created_at: new Date() };
    if (type === "cash") {
      if (!name) return res.status(400).json({ success: false, message: "Cash account requires a name" });
      doc.name = name;
    } else if (type === "bank") {
      if (!bank_name || !account_number) return res.status(400).json({ success: false, message: "Bank name and account number are required" });
      doc.bank_name = bank_name;
      doc.account_number = account_number;
      doc.routing_number = routing_number || "";
      doc.branch_name = branch_name || "";
    } else if (type === "mobile") {
      if (!number || !owner_name) return res.status(400).json({ success: false, message: "Mobile number and owner name are required" });
      doc.method = method || "bkash";
      doc.number = number;
      doc.owner_name = owner_name;
    } else {
      return res.status(400).json({ success: false, message: "Invalid account type" });
    }

    const result = await accountsCol.insertOne(doc);

    res.status(201).json({
      success: true,
      message: "Account created",
      data: { _id: result.insertedId, ...doc },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------------------------
// GET ALL ACCOUNTS
// ---------------------------------------------
exports.getAccounts = async (req, res) => {
  try {
    const accounts = await accountsCol.find({}).sort({ created_at: -1 }).toArray();
    res.status(200).json({ success: true, data: accounts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------------------------
// GET SINGLE ACCOUNT
// ---------------------------------------------
exports.getAccountById = async (req, res) => {
  try {
    const id = req.params.id;

    const account = await accountsCol.findOne({ _id: new ObjectId(id) });
    if (!account) return res.status(404).json({ success: false, message: "Account not found" });

    res.status(200).json({ success: true, data: account });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------------------------
// UPDATE ACCOUNT
// ---------------------------------------------
exports.updateAccount = async (req, res) => {
  try {
    const id = req.params.id;
    const updateData = {};

    const fields = [
      "type",
      "name",
      "balance",
      "method",
      "number",
      "owner_name",
      "bank_name",
      "account_number",
      "routing_number",
      "branch_name",
    ];

    fields.forEach((f) => {
      if (req.body[f] !== undefined) updateData[f] = req.body[f];
    });

    const result = await accountsCol.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) return res.status(404).json({ success: false, message: "Account not found" });

    res.status(200).json({ success: true, message: "Account updated" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------------------------
// DELETE ACCOUNT
// ---------------------------------------------
exports.deleteAccount = async (req, res) => {
  try {
    const id = req.params.id;

    // Prevent deletion if transactions exist
    const txnExists = await transactionsCol.findOne({ account_id: id });
    if (txnExists) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete. Transactions exist for this account.",
      });
    }

    const result = await accountsCol.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, message: "Account not found" });

    res.status(200).json({ success: true, message: "Account deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
