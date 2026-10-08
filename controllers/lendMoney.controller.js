const { ObjectId } = require("mongodb");
const { client, db } = require("../db");
const { updateAccountBalance } = require("../services/accountBalance.service");
const { normalizeIdV2 } = require("../utils/id.util");

const lendMoneyCol = db.collection("lend_money");

/* =====================================================
   1️⃣ CREATE LEND RECORD (DISBURSE CASH ADVANCE / LOAN)
===================================================== */
async function createLendRecord(req, res) {
  const session = client.startSession();

  try {
    const {
      borrower_name,
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
    if (!borrower_name || !borrower_name.trim()) {
      return res.status(400).json({ success: false, message: "Borrower/Recipient name is required" });
    }
    const lendAmount = Number(amount);
    if (!lendAmount || lendAmount <= 0) {
      return res.status(400).json({ success: false, message: "A valid loan amount is required" });
    }
    if (!account_id) {
      return res.status(400).json({ success: false, message: "Disbursing payment account is required" });
    }

    let lendDate = new Date();
    if (date) {
      const parsed = new Date(date);
      if (!isNaN(parsed.getTime())) lendDate = parsed;
    }

    const accountObjId = normalizeIdV2(account_id, "account_id");
    const lendId = new ObjectId();

    await session.startTransaction();

    // 1. Debit Payment Account (Money leaves company account)
    const paymentResult = await updateAccountBalance({
      client,
      db,
      amount: lendAmount,
      transactionType: "debit",
      entrySource: "lend_money",
      accountId: accountObjId.toString(),
      details: {
        lendId,
        borrower_name,
        remarks: remarks || `Loan disbursed to ${borrower_name}`
      }
    });

    if (!paymentResult.success) {
      throw new Error(paymentResult.message || "Failed to withdraw funds from selected account");
    }

    // 2. Insert Lend Document
    const lendDoc = {
      _id: lendId,
      borrower_name: borrower_name.trim(),
      phone: phone.trim(),
      address: address.trim(),
      amount: lendAmount,
      repaid_amount: 0,
      due_amount: lendAmount,
      status: "unpaid", // "unpaid", "partial", "repaid"
      payment_method,
      account_id: accountObjId,
      due_date: due_date ? new Date(due_date) : null,
      remarks: remarks.trim(),
      date: lendDate,
      repayment_history: [],
      created_at: new Date()
    };

    await lendMoneyCol.insertOne(lendDoc, { session });

    await session.commitTransaction();

    return res.status(201).json({
      success: true,
      message: "Loan recorded and funds disbursed successfully",
      data: lendDoc
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("Lend Money Failed:", err);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    await session.endSession();
  }
}

/* =====================================================
   2️⃣ GET ALL LEND RECORDS
===================================================== */
async function getLendRecords(req, res) {
  try {
    const records = await lendMoneyCol
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
    console.error("getLendRecords error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/* =====================================================
   3️⃣ RECEIVE REPAYMENT ON A LOAN
===================================================== */
async function receiveRepayment(req, res) {
  const session = client.startSession();

  try {
    const lendId = normalizeIdV2(req.params.id, "lendId");
    const { amount, account_id, payment_method = "cash", notes = "", date } = req.body;

    const returnAmount = Number(amount);
    if (!returnAmount || returnAmount <= 0) {
      return res.status(400).json({ success: false, message: "Valid repayment amount is required" });
    }
    if (!account_id) {
      return res.status(400).json({ success: false, message: "Receiving account is required" });
    }

    await session.startTransaction();

    const existingRecord = await lendMoneyCol.findOne({ _id: lendId }, { session });
    if (!existingRecord) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Loan record not found" });
    }

    const currentDue = Number(existingRecord.due_amount || 0);
    if (returnAmount > currentDue) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Repayment amount (৳${returnAmount}) exceeds outstanding due (৳${currentDue})`
      });
    }

    const accountObjId = normalizeIdV2(account_id, "account_id");

    // 1. Credit Payment Account (Funds return to our company)
    const paymentResult = await updateAccountBalance({
      client,
      db,
      amount: returnAmount,
      transactionType: "credit",
      entrySource: "lend_money_repayment",
      accountId: accountObjId.toString(),
      details: {
        lendId,
        borrower_name: existingRecord.borrower_name,
        remarks: notes || `Loan repayment received from ${existingRecord.borrower_name}`
      }
    });

    if (!paymentResult.success) {
      throw new Error(paymentResult.message || "Failed to credit account balance");
    }

    // 2. Update Lend Document
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

    await lendMoneyCol.updateOne(
      { _id: lendId },
      {
        $set: {           repaid_amount: newRepaid,           due_amount: newDue,           status: newStatus,           updated_at: new Date()         },$push: {
          repayment_history: repaymentEntry
        }
      },
      { session }
    );

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: "Repayment recorded and account credited successfully",
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
   4️⃣ CANCEL & DELETE LEND RECORD
===================================================== */
async function deleteLendRecord(req, res) {
  const session = client.startSession();

  try {
    const lendId = normalizeIdV2(req.params.id, "lendId");
    const existing = await lendMoneyCol.findOne({ _id: lendId });

    if (!existing) {
      return res.status(404).json({ success: false, message: "Loan record not found" });
    }

    await session.startTransaction();

    // 1. Revert original disbursed amount back to account (Credit company account)
    if (Number(existing.amount || 0) > 0 && existing.account_id) {
      const creditResult = await updateAccountBalance({
        client,
        db,
        amount: Number(existing.amount),
        transactionType: "credit",
        entrySource: "lend_money_delete_revert",
        accountId: existing.account_id.toString(),
        details: {
          lendId,
          remarks: `Revert loan disbursement for cancelled loan to ${existing.borrower_name}`
        }
      });

      if (!creditResult.success) throw new Error(creditResult.message);
    }

    // 2. Revert any repayments collected (Debit back from accounts)
    for (const rep of existing.repayment_history || []) {
      if (rep.amount > 0 && rep.account_id) {
        const debitResult = await updateAccountBalance({
          client,
          db,
          amount: Number(rep.amount),
          transactionType: "debit",
          entrySource: "lend_money_delete_repay_revert",
          accountId: rep.account_id.toString(),
          details: {
            lendId,
            remarks: `Revert repayment collected on cancelled loan #${lendId.toString().slice(-6)}`
          }
        });

        if (!debitResult.success) throw new Error(debitResult.message);
      }
    }

    // 3. Delete Document
    await lendMoneyCol.deleteOne({ _id: lendId }, { session });

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: "Loan record cancelled and account balances reverted successfully"
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("Delete lend record failed:", err);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    await session.endSession();
  }
}

/* =====================================================
   UPDATE LEND RECORD (EDIT LOAN DETAILS & RECONCILE ACCOUNT)
===================================================== */
async function updateLendRecord(req, res) {
  const session = client.startSession();

  try {
    const lendId = normalizeIdV2(req.params.id, "lendId");
    const {
      borrower_name,
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

    // 1️⃣ Validation
    if (!borrower_name || !borrower_name.trim()) {
      return res.status(400).json({ success: false, message: "Borrower name is required" });
    }
    if (!newAmount || newAmount <= 0) {
      return res.status(400).json({ success: false, message: "Valid loan amount is required" });
    }
    if (!account_id) {
      return res.status(400).json({ success: false, message: "Account selection is required" });
    }

    await session.startTransaction();

    const existing = await lendMoneyCol.findOne({ _id: lendId }, { session });
    if (!existing) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Loan record not found" });
    }

    // 2️⃣ Check Repaid Threshold
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

    // 3️⃣ Reconcile Disbursed Account Balances
    if (oldAccountIdStr && newAccountIdStr && oldAccountIdStr === newAccountIdStr) {
      const diff = newAmount - oldAmount;
      if (diff > 0) {
        // Loan increased: debit additional funds from account
        const payRes = await updateAccountBalance({
          client,
          db,
          amount: diff,
          transactionType: "debit",
          entrySource: "lend_money_update",
          accountId: newAccountIdStr,
          details: {
            lendId,
            remarks: `Disbursed additional ৳${diff} for loan to ${borrower_name}`
          }
        });
        if (!payRes.success) throw new Error(payRes.message);
      } else if (diff < 0) {
        // Loan reduced: refund company account
        const creditRes = await updateAccountBalance({
          client,
          db,
          amount: Math.abs(diff),
          transactionType: "credit",
          entrySource: "lend_money_update",
          accountId: newAccountIdStr,
          details: {
            lendId,
            remarks: `Refunded ৳${Math.abs(diff)} from reduced loan amount to ${borrower_name}`
          }
        });
        if (!creditRes.success) throw new Error(creditRes.message);
      }
    } else {
      // Switched payment accounts: credit back old account, debit from new account
      if (oldAmount > 0 && oldAccountIdStr) {
        const revRes = await updateAccountBalance({
          client,
          db,
          amount: oldAmount,
          transactionType: "credit",
          entrySource: "lend_money_update_switch",
          accountId: oldAccountIdStr,
          details: {
            lendId,
            remarks: `Revert disbursed loan on account switch for ${borrower_name}`
          }
        });
        if (!revRes.success) throw new Error(revRes.message);
      }

      if (newAmount > 0) {
        const payRes = await updateAccountBalance({
          client,
          db,
          amount: newAmount,
          transactionType: "debit",
          entrySource: "lend_money_update_switch",
          accountId: newAccountIdStr,
          details: {
            lendId,
            remarks: `Debit loan disbursement on account switch for ${borrower_name}`
          }
        });
        if (!payRes.success) throw new Error(payRes.message);
      }
    }

    // 4️⃣ Compute updated due and status
    const newDue = newAmount - repaidAmount;
    const newStatus = newDue === 0 ? "repaid" : (repaidAmount > 0 ? "partial" : "unpaid");

    let lendDate = existing.date;
    if (date) {
      const parsed = new Date(date);
      if (!isNaN(parsed.getTime())) lendDate = parsed;
    }

    // 5️⃣ Update Document
    await lendMoneyCol.updateOne(
      { _id: lendId },
      {
        $set: {
          borrower_name: borrower_name.trim(),
          phone: phone.trim(),
          address: address.trim(),
          amount: newAmount,
          due_amount: newDue,
          status: newStatus,
          payment_method,
          account_id: newAccountIdObj,
          due_date: due_date ? new Date(due_date) : null,
          remarks: remarks.trim(),
          date: lendDate,
          updated_at: new Date()
        }
      },
      { session }
    );

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: "Loan record updated successfully"
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("updateLendRecord error:", err);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    await session.endSession();
  }
}

module.exports = {
  createLendRecord,
  getLendRecords,
  receiveRepayment,
  updateLendRecord, // 👈 Export here
  deleteLendRecord
};
