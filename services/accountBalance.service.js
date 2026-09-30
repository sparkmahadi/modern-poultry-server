const { ObjectId } = require("mongodb");

/**
 * Updates a payment account's balance and records an audit transaction entry.
 * Safely handles both standalone executions and caller-provided MongoDB sessions/transactions.
 */
async function updateAccountBalance({
  client,
  db,
  amount,
  transactionType, // "credit" (inflow/income) | "debit" (outflow/expense)
  entrySource,     // "sale" | "purchase" | "bill_create" | "customer_due_payment" | etc.
  accountId,
  details = {},
  session: externalSession = null
}) {
  // Use caller session if supplied (e.g. inside an outer transaction), else spawn a local one
  const session = externalSession || client.startSession();
  const isLocalSession = !externalSession;

  try {
    if (isLocalSession) {
      await session.startTransaction();
    }

    /* -----------------------
       VALIDATIONS
    ----------------------- */
    if (!accountId) {
      return { success: false, message: "Account ID is required" };
    }

    const numericAmount = Number(amount);
    if (!numericAmount || numericAmount <= 0) {
      return { success: false, message: "Invalid transaction amount" };
    }

    const accountsCol = db.collection("payment_accounts");
    const transactionsCol = db.collection("transactions");

    const account = await accountsCol.findOne(
      { _id: new ObjectId(accountId) },
      { session }
    );

    if (!account) {
      return { success: false, message: "Payment account not found" };
    }

    const previousBalance = Number(account.balance || 0);

    /* -----------------------
       BALANCE CALCULATION
    ----------------------- */
    let newBalance;
    if (transactionType === "credit") {
      newBalance = previousBalance + numericAmount;
    } else if (transactionType === "debit") {
      if (previousBalance < numericAmount) {
        return { success: false, message: `Insufficient balance in ${account.bank_name || account.name || "account"}` };
      }
      newBalance = previousBalance - numericAmount;
    } else {
      return { success: false, message: "Invalid transaction type (must be 'credit' or 'debit')" };
    }

    /* -----------------------
       ATOMIC ACCOUNT UPDATE
    ----------------------- */
    await accountsCol.updateOne(
      { _id: account._id },
      { 
        $set: { 
          balance: newBalance,
          updatedAt: new Date()
        } 
      },
      { session }
    );

    /* -----------------------
       TRANSACTION LOG
    ----------------------- */
    await transactionsCol.insertOne(
      {
        date: new Date(),
        time: new Date().toTimeString().split(" ")[0],
        account_id: account._id,
        account_type: account.type || "",
        entry_source: entrySource,
        transaction_type: transactionType,
        amount: numericAmount,
        balance_before_transaction: previousBalance,
        balance_after_transaction: newBalance,
        payment_details: details.paymentDetails || {},
        products: details.products || [],
        reference_id: details.invoiceId || details.memoId || details.saleId || details.bill_id || null,
        created_by: details.createdBy || "system",
        remarks: details.remarks || ""
      },
      { session }
    );

    if (isLocalSession) {
      await session.commitTransaction();
    }

    return {
      success: true,
      message: "Account balance updated successfully",
      balance: newBalance
    };

  } catch (error) {
    if (isLocalSession) {
      await session.abortTransaction();
    }
    console.error("Account balance update failed:", error.message);
    return {
      success: false,
      message: error.message || "Account balance update failed"
    };
  } finally {
    if (isLocalSession) {
      await session.endSession();
    }
  }
}

module.exports = { updateAccountBalance };



// how to use

// import { updateAccountBalance } from "../services/accountBalance.service.js";

// export async function createSale(req, res) {
//   try {
//     const { paid_amount, account_id, memoNo } = req.body;

    // if (paid_amount > 0) {
    //   await updateAccountBalance({
    //     client,
    //     db,
    //     amount: paid_amount,
    //     transactionType: "debit",
    //     entrySource: "purchase",
    //     accountId: account_id,
    //     details: {
    //       invoiceId: invoice_id,
    //       paymentMethod: payment_method,
    //     },
    //   });
    // }

//     res.status(201).json({ success: true });

//   } catch (err) {
//     res.status(400).json({ success: false, message: err.message });
//   }
// }
