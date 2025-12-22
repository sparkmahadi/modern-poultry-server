const { ObjectId } = require("mongodb");
const { db } = require("../db.js");

const billsCol = db.collection("bills");
const expenseThreadsCol = db.collection("expense_threads");

/* --------------------------------------------------
   GET ALL BILLS
-------------------------------------------------- */
async function getBills(req, res) {
  try {
    const bills = await billsCol
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      data: bills
    });
  } catch (error) {
    console.error("GET BILLS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch bills"
    });
  }
}

/* --------------------------------------------------
   GET SINGLE BILL
-------------------------------------------------- */
async function getBillById(req, res) {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid bill ID" });

    const bill = await billsCol.findOne({ _id: new ObjectId(id) });

    if (!bill)
      return res.status(404).json({ success: false, message: "Bill not found" });

    return res.status(200).json({
      success: true,
      data: bill
    });
  } catch (error) {
    console.error("GET BILL ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch bill"
    });
  }
}

/* --------------------------------------------------
   CREATE BILL
-------------------------------------------------- */
async function createBill(req, res) {
  try {
    const {
      billName,
      amount,
      expenseThreadId,
      payment_details,
      remarks
    } = req.body;

    if (!billName || amount === undefined || !expenseThreadId)
      return res.status(400).json({
        success: false,
        message: "Bill name, amount and expense thread are required"
      });

    if (!ObjectId.isValid(expenseThreadId))
      return res.status(400).json({
        success: false,
        message: "Invalid expense thread ID"
      });

    // Fetch thread snapshot
    const thread = await expenseThreadsCol.findOne({
      _id: new ObjectId(expenseThreadId)
    });

    if (!thread)
      return res.status(404).json({
        success: false,
        message: "Expense thread not found"
      });

    const payload = {
      billName: billName.trim(),
      amount: Number(amount),

      expenseThreadId: new ObjectId(expenseThreadId),
      expenseThreadName: thread.name,

      payment_details: {
        payment_method: payment_details?.payment_method || "",
        account_id: payment_details?.account_id
          ? new ObjectId(payment_details.account_id)
          : null,
        paid_amount: Number(payment_details?.paid_amount || 0)
      },

      remarks: remarks || "",

      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await billsCol.insertOne(payload);

    return res.status(201).json({
      success: true,
      message: "Bill created successfully",
      data: { _id: result.insertedId, ...payload }
    });
  } catch (error) {
    console.error("CREATE BILL ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create bill"
    });
  }
}

/* --------------------------------------------------
   UPDATE BILL
-------------------------------------------------- */
async function updateBill(req, res) {
  try {
    const { id } = req.params;
    const {
      billName,
      amount,
      expenseThreadId,
      paymentAc,
      payment_details,
      remarks
    } = req.body;

    if (!ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid bill ID" });

    let threadSnapshot = {};

    if (expenseThreadId) {
      if (!ObjectId.isValid(expenseThreadId))
        return res.status(400).json({
          success: false,
          message: "Invalid expense thread ID"
        });

      const thread = await expenseThreadsCol.findOne({
        _id: new ObjectId(expenseThreadId)
      });

      if (!thread)
        return res.status(404).json({
          success: false,
          message: "Expense thread not found"
        });

      threadSnapshot = {
        expenseThreadId: new ObjectId(expenseThreadId),
        expenseThreadName: thread.name
      };
    }

    const updateDoc = {
      $set: {
        ...(billName && { billName: billName.trim() }),
        ...(amount !== undefined && { amount: Number(amount) }),
        ...(paymentAc && { paymentAc }),
        ...(remarks !== undefined && { remarks }),
        ...(payment_details && {
          payment_details: {
            payment_method: payment_details.payment_method || "",
            account_id: payment_details.account_id
              ? new ObjectId(payment_details.account_id)
              : null,
            paid_amount: Number(payment_details.paid_amount || 0)
          }
        }),
        ...threadSnapshot,
        updatedAt: new Date()
      }
    };

    const result = await billsCol.updateOne(
      { _id: new ObjectId(id) },
      updateDoc
    );

    if (!result.matchedCount)
      return res.status(404).json({ success: false, message: "Bill not found" });

    return res.status(200).json({
      success: true,
      message: "Bill updated successfully"
    });
  } catch (error) {
    console.error("UPDATE BILL ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update bill"
    });
  }
}

/* --------------------------------------------------
   DELETE BILL
-------------------------------------------------- */
async function deleteBill(req, res) {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid bill ID" });

    const result = await billsCol.deleteOne({ _id: new ObjectId(id) });

    if (!result.deletedCount)
      return res.status(404).json({ success: false, message: "Bill not found" });

    return res.status(200).json({
      success: true,
      message: "Bill deleted successfully"
    });
  } catch (error) {
    console.error("DELETE BILL ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete bill"
    });
  }
}

module.exports = {
  getBills,
  getBillById,
  createBill,
  updateBill,
  deleteBill
};
