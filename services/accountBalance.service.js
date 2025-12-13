import { ObjectId } from "mongodb";

export async function updateAccountBalance({
  client,
  db,
  amount,
  transactionType,   // "credit" | "debit"
  entrySource,        // "sale" | "purchase" | "return" | "due_collection"
  accountId,
  details = {}
}) {
  const session = client.startSession();

  try {
    await session.startTransaction();

    /* -----------------------
       VALIDATIONS
    ----------------------- */
    if (!accountId) {
      return { success: false, message: "Account ID is required" };
    }

    if (!amount || amount <= 0) {
      return { success: false, message: "Invalid transaction amount" };
    }

    const accountsCol = db.collection("payment_accounts");
    const transactionsCol = db.collection("transactions");

    const account = await accountsCol.findOne(
      { _id: new ObjectId(accountId) },
      { session }
    );

    if (!account) {
      return { success: false, message: "Account not found" };
    }

    const previousBalance = Number(account.balance || 0);

    /* -----------------------
       BALANCE CALCULATION
    ----------------------- */
    let newBalance;

    if (transactionType === "credit") {
      newBalance = previousBalance + amount;
    } else if (transactionType === "debit") {
      if (previousBalance < amount) {
        return { success: false, message: "Insufficient balance" };
      }
      newBalance = previousBalance - amount;
    } else {
      return { success: false, message: "Invalid transaction type" };
    }

    /* -----------------------
       ACCOUNT UPDATE
    ----------------------- */
    await accountsCol.updateOne(
      { _id: account._id },
      { $set: { balance: newBalance } },
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
        account_type: account.type,

        entry_source: entrySource,
        transaction_type: transactionType,
        amount,

        balance_before_transaction: previousBalance,
        balance_after_transaction: newBalance,

        payment_details: details.paymentDetails || {},
        products: details.products || [],
        reference_id: details.invoiceId || details.memoId || null,

        created_by: details.createdBy || "admin",
        remarks: details.remarks || ""
      },
      { session }
    );

    await session.commitTransaction();

    return {
      success: true,
      message: "Account balance updated successfully",
      balance: newBalance
    };

  } catch (error) {
    await session.abortTransaction();

    console.error("Account balance update failed:", error.message);

    return {
      success: false,
      message: error.message || "Account balance update failed"
    };
  } finally {
    await session.endSession();
  }
}




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
