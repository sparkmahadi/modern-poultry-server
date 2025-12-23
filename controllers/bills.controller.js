const { ObjectId } = require("mongodb");
const { client, db } = require("../db.js");
const { updateAccountBalance } = require("../services/accountBalance.service.js");

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

async function createBill(req, res) {
  const session = client.startSession();

  try {
    const { billName, amount, expenseThreadId, payment_details, remarks } = req.body;

    if (!billName || amount === undefined || !expenseThreadId)
      return res.status(400).json({ success: false, message: "Required fields missing" });

    if (!ObjectId.isValid(expenseThreadId))
      return res.status(400).json({ success: false, message: "Invalid expense thread ID" });

    await session.startTransaction();

    /* ---------------------------------------------
       1️⃣ FETCH THREAD (LOCKED IN TRANSACTION)
    --------------------------------------------- */
    const thread = await expenseThreadsCol.findOne(
      { _id: new ObjectId(expenseThreadId) },
      { session }
    );

    if (!thread)
      throw new Error("Expense thread not found");

    const billAmount = Number(amount);

    /* ---------------------------------------------
       2️⃣ PREPARE BILL DOCUMENT
    --------------------------------------------- */
    const payload = {
      billName: billName.trim(),
      amount: billAmount,

      expenseThreadId: thread._id,
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

    /* ---------------------------------------------
       3️⃣ INSERT BILL
    --------------------------------------------- */
    const billResult = await billsCol.insertOne(payload, { session });

    /* ---------------------------------------------
       4️⃣ INCREMENT THREAD TOTAL COST
    --------------------------------------------- */
    await expenseThreadsCol.updateOne(
      { _id: thread._id },
      { $inc: { total_cost: billAmount } },
      { session }
    );

    /* ---------------------------------------------
       5️⃣ DEBIT ACCOUNT (IF PAID)
    --------------------------------------------- */
    const paidAmount = payload.payment_details.paid_amount;

    if (paidAmount > 0 && payload.payment_details.account_id) {
      const paymentResult = await updateAccountBalance({
        client,
        db,
        session,
        amount: paidAmount,
        transactionType: "debit",
        entrySource: `expense - ${payload.billName}`,
        bill_id: billResult.insertedId,
        accountId: payload.payment_details.account_id
      });

      if (!paymentResult.success)
        throw new Error(paymentResult.message);
    }

    await session.commitTransaction();

    return res.status(201).json({
      success: true,
      message: "Bill created successfully",
      data: { _id: billResult.insertedId, ...payload }
    });

  } catch (error) {
    await session.abortTransaction();
    console.error("CREATE BILL ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create bill"
    });
  } finally {
    await session.endSession();
  }
}


/* --------------------------------------------------
   UPDATE BILL
-------------------------------------------------- */
async function updateBill(req, res) {
  const session = client.startSession();

  try {
    const { id } = req.params;
    const { billName, amount, expenseThreadId, payment_details, remarks } = req.body;

    if (!ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid bill ID" });

    await session.startTransaction();

    /* ---------------------------------------------
       1️⃣ FETCH EXISTING BILL
    --------------------------------------------- */
    const existingBill = await billsCol.findOne(
      { _id: new ObjectId(id) },
      { session }
    );

    if (!existingBill)
      throw new Error("Bill not found");

    const oldAmount = Number(existingBill.amount);
    const newAmount = amount !== undefined ? Number(amount) : oldAmount;

    const oldThreadId = existingBill.expenseThreadId;
    const newThreadId = expenseThreadId
      ? new ObjectId(expenseThreadId)
      : oldThreadId;

    /* ---------------------------------------------
       2️⃣ HANDLE THREAD / AMOUNT CHANGE
    --------------------------------------------- */
    if (!oldThreadId.equals(newThreadId)) {
      // Remove from old thread
      await expenseThreadsCol.updateOne(
        { _id: oldThreadId },
        { $inc: { total_cost: -oldAmount } },
        { session }
      );

      // Add to new thread
      await expenseThreadsCol.updateOne(
        { _id: newThreadId },
        { $inc: { total_cost: newAmount } },
        { session }
      );
    } else if (oldAmount !== newAmount) {
      // Same thread, apply difference only
      await expenseThreadsCol.updateOne(
        { _id: oldThreadId },
        { $inc: { total_cost: newAmount - oldAmount } },
        { session }
      );
    }

    /* ---------------------------------------------
       3️⃣ UPDATE BILL DOCUMENT
    --------------------------------------------- */
    const updateDoc = {
      $set: {
        ...(billName && { billName: billName.trim() }),
        ...(amount !== undefined && { amount: newAmount }),
        ...(expenseThreadId && { expenseThreadId: newThreadId }),
        ...(payment_details && {
          payment_details: {
            payment_method: payment_details.payment_method || "",
            account_id: payment_details.account_id
              ? new ObjectId(payment_details.account_id)
              : null,
            paid_amount: Number(payment_details.paid_amount || 0)
          }
        }),
        ...(remarks !== undefined && { remarks }),
        updatedAt: new Date()
      }
    };

    await billsCol.updateOne(
      { _id: existingBill._id },
      updateDoc,
      { session }
    );

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: "Bill updated successfully"
    });

  } catch (error) {
    await session.abortTransaction();
    console.error("UPDATE BILL ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update bill"
    });
  } finally {
    await session.endSession();
  }
}



/* --------------------------------------------------
   DELETE BILL
-------------------------------------------------- */
async function deleteBill(req, res) {
  const session = client.startSession();

  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid bill ID" });

    await session.startTransaction();

    /* ---------------------------------------------
       1️⃣ FETCH BILL
    --------------------------------------------- */
    const bill = await billsCol.findOne(
      { _id: new ObjectId(id) },
      { session }
    );

    if (!bill)
      throw new Error("Bill not found");

    /* ---------------------------------------------
       2️⃣ DELETE BILL
    --------------------------------------------- */
    await billsCol.deleteOne(
      { _id: bill._id },
      { session }
    );

    /* ---------------------------------------------
       3️⃣ DECREMENT THREAD TOTAL COST
    --------------------------------------------- */
    await expenseThreadsCol.updateOne(
      { _id: bill.expenseThreadId },
      { $inc: { total_cost: -Number(bill.amount) } },
      { session }
    );

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: "Bill deleted successfully"
    });

  } catch (error) {
    await session.abortTransaction();
    console.error("DELETE BILL ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to delete bill"
    });
  } finally {
    await session.endSession();
  }
}



module.exports = {
  getBills,
  getBillById,
  createBill,
  updateBill,
  deleteBill
};
