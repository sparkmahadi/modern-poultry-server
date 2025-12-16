const { ObjectId } = require("mongodb");
const { db } = require("../db");

const accountsCol = db.collection("payment_accounts");
const transactionsCol = db.collection("transactions");

/**
 * =====================================================
 * CREATE ACCOUNT (SESSION SAFE)
 * =====================================================
 */
exports.createAccount = async (req, res) => {
  const session = db.client.startSession();

  try {
    session.startTransaction();

    const {
      type,
      method,
      name,
      balance,
      bank_name,
      account_number,
      routing_number,
      branch_name,
      number,
      owner_name,
      is_default = false,
    } = req.body;

    console.log('hit create account ', req.body);

    if (!type) throw new Error("Account type is required");

    const doc = {
      type,
      balance: Number(balance) || 0,
      is_default: Boolean(is_default),
      created_at: new Date(),
    };

    // ------------------ Type validations ------------------
    if (type === "cash") {
      if (!name) throw new Error("Cash account requires name");
      doc.name = name;
    } 
    else if (type === "bank") {
      if (!bank_name || !account_number)
        throw new Error("Bank name and account number required");

      doc.bank_name = bank_name;
      doc.account_number = account_number;
      doc.routing_number = routing_number || "";
      doc.branch_name = branch_name || "";
    } 
    else if (type === "mobile") {
      if (!number || !owner_name)
        throw new Error("Mobile number and owner name required");

      doc.method = method || "bkash";
      doc.number = number;
      doc.owner_name = owner_name;
    } 
    else {
      throw new Error("Invalid account type");
    }

    // --------- Enforce single default per category ----------
    if (doc.is_default) {
      const filter =
        type === "mobile"
          ? { type: "mobile", method: doc.method }
          : { type };

      await accountsCol.updateMany(
        filter,
        { $set: { is_default: false } },
        { session }
      );
    }

    const result = await accountsCol.insertOne(doc, { session });

    await session.commitTransaction();

    res.status(201).json({
      success: true,
      message: "Account created",
      data: { _id: result.insertedId, ...doc },
    });

  } catch (err) {
    await session.abortTransaction();
    console.log(err.message);
    res.status(400).json({ success: false, message: err.message });
  } finally {
    session.endSession();
  }
};

/**
 * =====================================================
 * GET ALL ACCOUNTS
 * =====================================================
 */
exports.getAccounts = async (req, res) => {
  try {
    const accounts = await accountsCol
      .find({})
      .sort({ created_at: -1 })
      .toArray();

    res.status(200).json({ success: true, data: accounts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * =====================================================
 * GET SINGLE ACCOUNT
 * =====================================================
 */
exports.getAccountById = async (req, res) => {
  try {
    const account = await accountsCol.findOne({
      _id: new ObjectId(req.params.id),
    });

    if (!account)
      return res.status(404).json({ success: false, message: "Account not found" });

    res.status(200).json({ success: true, data: account });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * =====================================================
 * UPDATE ACCOUNT (SESSION SAFE)
 * =====================================================
 */
exports.updateAccount = async (req, res) => {
  const session = db.client.startSession();

  try {
    session.startTransaction();

    const id = req.params.id;
    const updateData = {};

    const allowedFields = [
      "name",
      "balance",
      "method",
      "number",
      "owner_name",
      "bank_name",
      "account_number",
      "routing_number",
      "branch_name",
      "is_default",
    ];

    allowedFields.forEach((f) => {
      if (req.body[f] !== undefined) updateData[f] = req.body[f];
    });

    const account = await accountsCol.findOne(
      { _id: new ObjectId(id) },
      { session }
    );

    if (!account) throw new Error("Account not found");

    // ---------- Handle default switch ----------
    if (updateData.is_default === true) {
      const filter =
        account.type === "mobile"
          ? { type: "mobile", method: account.method }
          : { type: account.type };

      await accountsCol.updateMany(
        filter,
        { $set: { is_default: false } },
        { session }
      );
    }
    await accountsCol.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData },
      { session }
    );
    
    console.log("updateData", updateData);
    await session.commitTransaction();

    res.status(200).json({ success: true, message: "Account updated" });

  } catch (err) {
    await session.abortTransaction();
    res.status(400).json({ success: false, message: err.message });
  } finally {
    session.endSession();
  }
};

/**
 * =====================================================
 * DELETE ACCOUNT (SAFE)
 * =====================================================
 */
exports.deleteAccount = async (req, res) => {
  try {
    const id = req.params.id;

    const account = await accountsCol.findOne({ _id: new ObjectId(id) });
    if (!account)
      return res.status(404).json({ success: false, message: "Account not found" });

    if (account.is_default) {
      return res.status(400).json({
        success: false,
        message: "Default account cannot be deleted",
      });
    }

    const txnExists = await transactionsCol.findOne({ account_id: id });
    if (txnExists) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete. Transactions exist for this account.",
      });
    }

    await accountsCol.deleteOne({ _id: new ObjectId(id) });

    res.status(200).json({ success: true, message: "Account deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * =====================================================
 * GET DEFAULT ACCOUNT (FOR PURCHASE / SALES)
 * =====================================================
 */
exports.getDefaultAccount = async (req, res) => {
  try {
    const { type, method } = req.query;

    if (!type)
      return res.status(400).json({ success: false, message: "Type is required" });

    const filter =
      type === "mobile"
        ? { type: "mobile", method, is_default: true }
        : { type, is_default: true };

    const account = await accountsCol.findOne(filter);

    if (!account)
      return res.status(404).json({ success: false, message: "Default account not found" });

    res.status(200).json({ success: true, data: account });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
