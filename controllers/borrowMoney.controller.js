const { ObjectId } = require("mongodb");
const { client, db } = require("../db");
const { updateAccountBalance } = require("../services/accountBalance.service");
const { normalizeIdV2 } = require("../utils/id.util");

const borrowMoneyCol = db.collection("borrow_money");

/* =====================================================
   1️⃣ CREATE BORROW RECORD (RECEIVE LOAN / BORROW CASH)
===================================================== */
async function createBorrowRecord(req, res) {
  const session = client.startSession();

  try {
    const {
      lender_name,
      phone = "",
      address = "",
      amount,
      account_id,
      payment_method = "cash",
      due_date = null,
      remarks = "",
      date
    } = req.body;

    // Validations
    if (!lender_name || !lender_name.trim()) {
      return res.status(400).json({ success: false, message: "Lender / Source name is required" });
    }
    const borrowAmount = Number(amount);
    if (!borrowAmount || borrowAmount <= 0) {
      return res.status(400).json({ success: false, message: "A valid loan amount is required" });
    }
    if (!account_id) {
      return res.status(400).json({ success: false, message: "Deposit receiving account is required" });
    }

    let borrowDate = new Date();
    if (date) {
      const parsed = new Date(date);
      if (!isNaN(parsed.getTime())) borrowDate = parsed;
    }

    const accountObjId = normalizeIdV2(account_id, "account_id");
    const borrowId = new ObjectId();

    await session.startTransaction();

    // 1. Credit Payment Account (Money deposited into business account)
    const paymentResult = await updateAccountBalance({
      client,
      db,
      amount: borrowAmount,
      transactionType: "credit",
      entrySource: "borrow_money",
      accountId: accountObjId.toString(),
      details: {
        borrowId,
        lender_name,
        remarks: remarks || `Loan received from ${lender_name}`
      }
    });

    if (!paymentResult.success) {
      throw new Error(paymentResult.message || "Failed to deposit funds into selected account");
    }

    // 2. Insert Borrow Document
    const borrowDoc = {
      _id: borrowId,
      lender_name: lender_name.trim(),
      phone: phone.trim(),
      address: address.trim(),
      amount: borrowAmount,
      repaid_amount: 0,
      due_amount: borrowAmount,
      status: "unpaid", // "unpaid", "partial", "repaid"
      payment_method,
      account_id: accountObjId,
      due_date: due_date ? new Date(due_date) : null,
      remarks: remarks.trim(),
      date: borrowDate,
      repayment_history: [],
      created_at: new Date()
    };

    await borrowMoneyCol.insertOne(borrowDoc, { session });

    await session.commitTransaction();

    return res.status(201).json({
      success: true,
      message: "Loan recorded and deposited to account successfully",
      data: borrowDoc
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("Borrow Money Failed:", err);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    await session.endSession();
  }
}

/* =====================================================
   2️⃣ GET ALL BORROW RECORDS
===================================================== */
async function getBorrowRecords(req, res) {
  try {
    const records = await borrowMoneyCol
      .aggregate([
        {
          $lookup: {
            from: "payment_accounts",
            localField: "account_id",
            foreignField: "_id",
            as: "account"
          }
        },
        {
          $unwind: {
            path: "$account",
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $addFields: {
            account_name: "$account.name"
          }
        },
        {
          $project: { account: 0 }
        },
        {
          $sort: { date: -1 }
        }
      ])
      .toArray();

    return res.status(200).json({
      success: true,
      count: records.length,
      data: records
    });
  } catch (err) {
    console.error("getBorrowRecords error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/* =====================================================
   3️⃣ REPAY BORROWED LOAN (PAY BACK LENDER)
===================================================== */
async function repayBorrowedLoan(req, res) {
  const session = client.startSession();

  try {
    const borrowId = normalizeIdV2(req.params.id, "borrowId");
    const { amount, account_id, payment_method = "cash", notes = "", date } = req.body;

    const returnAmount = Number(amount);
    if (!returnAmount || returnAmount <= 0) {
      return res.status(400).json({ success: false, message: "Valid repayment amount is required" });
    }
    if (!account_id) {
      return res.status(400).json({ success: false, message: "Disbursing withdrawal account is required" });
    }

    await session.startTransaction();

    const existingRecord = await borrowMoneyCol.findOne({ _id: borrowId }, { session });
    if (!existingRecord) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Borrow record not found" });
    }

    const currentDue = Number(existingRecord.due_amount || 0);
    if (returnAmount > currentDue) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Repayment amount (৳${returnAmount}) exceeds outstanding debt (৳${currentDue})`
      });
    }

    const accountObjId = normalizeIdV2(account_id, "account_id");

    // 1. Debit Payment Account (Money leaves company to pay lender)
    const paymentResult = await updateAccountBalance({
      client,
      db,
      amount: returnAmount,
      transactionType: "debit",
      entrySource: "borrow_money_repayment",
      accountId: accountObjId.toString(),
      details: {
        borrowId,
        lender_name: existingRecord.lender_name,
        remarks: notes || `Repaid loan debt to ${existingRecord.lender_name}`
      }
    });

    if (!paymentResult.success) {
      throw new Error(paymentResult.message || "Failed to withdraw funds for loan repayment");
    }

    // 2. Update Borrow Document
    const newRepaid = Number(existingRecord.repaid_amount || 0) + returnAmount;
    const newDue = currentDue - returnAmount;
    const newStatus = newDue === 0 ? "repaid" : "partial";

    let repaymentDate = new Date();
    if (date) {
      const parsed = new Date(date);
      if (!isNaN(parsed.getTime())) repaymentDate = parsed;
    }

    const repaymentEntry = {
      repayment_id: new ObjectId(),
      amount: returnAmount,
      account_id: accountObjId,
      payment_method,
      date: repaymentDate,
      notes
    };

    await borrowMoneyCol.updateOne(
      { _id: borrowId },
      {
        $set: {
          repaid_amount: newRepaid,
          due_amount: newDue,
          status: newStatus,
          updated_at: new Date()
        },
        $push: {
          repayment_history: repaymentEntry
        }
      },
      { session }
    );

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: "Loan repayment recorded and account debited successfully",
      data: {
        repaid_amount: newRepaid,
        due_amount: newDue,
        status: newStatus
      }
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("Repayment error:", err);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    await session.endSession();
  }
}

/* =====================================================
   4️⃣ UPDATE BORROW RECORD
===================================================== */
async function updateBorrowRecord(req, res) {
  const session = client.startSession();

  try {
    const borrowId = normalizeIdV2(req.params.id, "borrowId");
    const {
      lender_name,
      phone = "",
      address = "",
      amount,
      account_id,
      payment_method = "cash",
      due_date = null,
      remarks = "",
      date
    } = req.body;

    const newAmount = Number(amount);

    if (!lender_name || !lender_name.trim()) {
      return res.status(400).json({ success: false, message: "Lender name is required" });
    }
    if (!newAmount || newAmount <= 0) {
      return res.status(400).json({ success: false, message: "Valid loan amount is required" });
    }
    if (!account_id) {
      return res.status(400).json({ success: false, message: "Account selection is required" });
    }

    await session.startTransaction();

    const existing = await borrowMoneyCol.findOne({ _id: borrowId }, { session });
    if (!existing) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Loan record not found" });
    }

    const repaidAmount = Number(existing.repaid_amount || 0);
    if (newAmount < repaidAmount) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `New loan amount (৳${newAmount}) cannot be less than already repaid amount (৳${repaidAmount})`
      });
    }

    const oldAmount = Number(existing.amount || 0);
    const oldAccountIdStr = existing.account_id ? existing.account_id.toString() : null;
    const newAccountIdObj = normalizeIdV2(account_id, "account_id");
    const newAccountIdStr = newAccountIdObj.toString();

    // Reconcile Borrowed Inflow Balances
    if (oldAccountIdStr && newAccountIdStr && oldAccountIdStr === newAccountIdStr) {
      const diff = newAmount - oldAmount;
      if (diff > 0) {
        // Loan increased: credit additional funds to business account
        const creditRes = await updateAccountBalance({
          client,
          db,
          amount: diff,
          transactionType: "credit",
          entrySource: "borrow_money_update",
          accountId: newAccountIdStr,
          details: {
            borrowId,
            remarks: `Received additional loan ৳${diff} from ${lender_name}`
          }
        });
        if (!creditRes.success) throw new Error(creditRes.message);
      } else if (diff < 0) {
        // Loan reduced: debit excess funds from business account
        const debitRes = await updateAccountBalance({
          client,
          db,
          amount: Math.abs(diff),
          transactionType: "debit",
          entrySource: "borrow_money_update",
          accountId: newAccountIdStr,
          details: {
            borrowId,
            remarks: `Deducted excess borrowed funds ৳${Math.abs(diff)} from ${lender_name}`
          }
        });
        if (!debitRes.success) throw new Error(debitRes.message);
      }
    } else {
      // Switched payment accounts: debit back old account, credit new account
      if (oldAmount > 0 && oldAccountIdStr) {
        const revRes = await updateAccountBalance({
          client,
          db,
          amount: oldAmount,
          transactionType: "debit",
          entrySource: "borrow_money_update_switch",
          accountId: oldAccountIdStr,
          details: {
            borrowId,
            remarks: `Revert borrowed deposit on account switch for ${lender_name}`
          }
        });
        if (!revRes.success) throw new Error(revRes.message);
      }

      if (newAmount > 0) {
        const creditRes = await updateAccountBalance({
          client,
          db,
          amount: newAmount,
          transactionType: "credit",
          entrySource: "borrow_money_update_switch",
          accountId: newAccountIdStr,
          details: {
            borrowId,
            remarks: `Credit borrowed deposit on account switch for ${lender_name}`
          }
        });
        if (!creditRes.success) throw new Error(creditRes.message);
      }
    }

    const newDue = newAmount - repaidAmount;
    const newStatus = newDue === 0 ? "repaid" : (repaidAmount > 0 ? "partial" : "unpaid");

    let borrowDate = existing.date;
    if (date) {
      const parsed = new Date(date);
      if (!isNaN(parsed.getTime())) borrowDate = parsed;
    }

    await borrowMoneyCol.updateOne(
      { _id: borrowId },
      {
        $set: {
          lender_name: lender_name.trim(),
          phone: phone.trim(),
          address: address.trim(),
          amount: newAmount,
          due_amount: newDue,
          status: newStatus,
          payment_method,
          account_id: newAccountIdObj,
          due_date: due_date ? new Date(due_date) : null,
          remarks: remarks.trim(),
          date: borrowDate,
          updated_at: new Date()
        }
      },
      { session }
    );

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: "Borrow record updated successfully"
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("updateBorrowRecord error:", err);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    await session.endSession();
  }
}

/* =====================================================
   5️⃣ CANCEL & DELETE BORROW RECORD
===================================================== */
async function deleteBorrowRecord(req, res) {
  const session = client.startSession();

  try {
    const borrowId = normalizeIdV2(req.params.id, "borrowId");
    const existing = await borrowMoneyCol.findOne({ _id: borrowId });

    if (!existing) {
      return res.status(404).json({ success: false, message: "Borrow record not found" });
    }

    await session.startTransaction();

    // 1. Revert original borrowed deposit from account (Debit company account)
    if (Number(existing.amount || 0) > 0 && existing.account_id) {
      const debitResult = await updateAccountBalance({
        client,
        db,
        amount: Number(existing.amount),
        transactionType: "debit",
        entrySource: "borrow_money_delete_revert",
        accountId: existing.account_id.toString(),
        details: {
          borrowId,
          remarks: `Revert borrowed loan deposit on delete for ${existing.lender_name}`
        }
      });

      if (!debitResult.success) throw new Error(debitResult.message);
    }

    // 2. Revert any repayments made (Credit back into account)
    for (const rep of existing.repayment_history || []) {
      if (rep.amount > 0 && rep.account_id) {
        const creditResult = await updateAccountBalance({
          client,
          db,
          amount: Number(rep.amount),
          transactionType: "credit",
          entrySource: "borrow_money_delete_repay_revert",
          accountId: rep.account_id.toString(),
          details: {
            borrowId,
            remarks: `Revert repayment outflow on cancelled borrow #${borrowId.toString().slice(-6)}`
          }
        });

        if (!creditResult.success) throw new Error(creditResult.message);
      }
    }

    // 3. Delete Document
    await borrowMoneyCol.deleteOne({ _id: borrowId }, { session });

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: "Borrow record cancelled and account balances reverted successfully"
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("Delete borrow record failed:", err);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    await session.endSession();
  }
}

module.exports = {
  createBorrowRecord,
  getBorrowRecords,
  repayBorrowedLoan,
  updateBorrowRecord,
  deleteBorrowRecord
};