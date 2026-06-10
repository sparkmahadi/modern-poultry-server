const { ObjectId } = require("mongodb");
const { client, db } = require("../db.js");
const { updateAccountBalance } = require("../services/accountBalance.service.js");

const billsCol = db.collection("bills");
const transactionCol = db.collection("transactions");
const expenseThreadsCol = db.collection("expense_threads");

/* --------------------------------------------------
   GET ALL BILLS
-------------------------------------------------- */

async function getBills(req, res) {
  try {
    const { date, month, year } = req.query;

    let filter = {};

    /* ------------------------------------- */
    /* DEFAULT: TODAY'S DATA (DATEWISE) */
    /* ------------------------------------- */
    const today = new Date();
    const startOfToday = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );

    const endOfToday = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + 1
    );

    filter.createdAt = {
      $gte: startOfToday,
      $lt: endOfToday,
    };

    /* ------------------------------------- */
    /* DATEWISE FILTER */
    /* Example: ?date=2026-05-11 */
    /* ------------------------------------- */
    if (date) {
      const selectedDate = new Date(date);

      if (isNaN(selectedDate)) {
        return res.status(400).json({
          success: false,
          message: "Invalid date format",
        });
      }

      const start = new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        selectedDate.getDate()
      );

      const end = new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        selectedDate.getDate() + 1
      );

      filter.createdAt = {
        $gte: start,
        $lt: end,
      };
    }

    /* ------------------------------------- */
    /* MONTHWISE FILTER */
    /* Example: ?month=2026-05 */
    /* ------------------------------------- */
    if (month) {
      const [yearPart, monthPart] = month.split("-");

      const parsedYear = Number(yearPart);
      const parsedMonth = Number(monthPart);

      if (!parsedYear || !parsedMonth) {
        return res.status(400).json({
          success: false,
          message: "Invalid month format",
        });
      }

      const start = new Date(
        parsedYear,
        parsedMonth - 1,
        1
      );

      const end = new Date(
        parsedYear,
        parsedMonth,
        1
      );

      filter.createdAt = {
        $gte: start,
        $lt: end,
      };
    }

    /* ------------------------------------- */
    /* YEARWISE FILTER */
    /* Example: ?year=2026 */
    /* ------------------------------------- */
    if (year) {
      const parsedYear = Number(year);

      if (!parsedYear) {
        return res.status(400).json({
          success: false,
          message: "Invalid year format",
        });
      }

      const start = new Date(parsedYear, 0, 1);

      const end = new Date(
        parsedYear + 1,
        0,
        1
      );

      filter.createdAt = {
        $gte: start,
        $lt: end,
      };
    }

    /* ------------------------------------- */
    /* FETCH BILLS */
    /* ------------------------------------- */
    const bills = await billsCol
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      total: bills.length,
      filterApplied: {
        date: date || null,
        month: month || null,
        year: year || null,
        default: !date && !month && !year
          ? "today"
          : null,
      },
      data: bills,
    });
  } catch (error) {
    console.error(
      "GET BILLS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to fetch bills",
      error: error.message,
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
    const {
      billName,
      amount,
      expenseThreadId,
      payment_details,
      remarks,
      createdAt
    } = req.body;

    /* ---------------------------------------------
       VALIDATION
    --------------------------------------------- */
    if (
      !billName ||
      amount === undefined ||
      !expenseThreadId
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Required fields missing"
      });
    }

    if (
      !ObjectId.isValid(
        expenseThreadId
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid expense thread ID"
      });
    }

    const paidAmount = Number(
      payment_details
        ?.paid_amount || 0
    );

    if (
      paidAmount > 0 &&
      !payment_details
        ?.account_id
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Account selection is required for payment"
      });
    }

    await session.startTransaction();

    /* ---------------------------------------------
       1️⃣ FETCH EXPENSE THREAD
    --------------------------------------------- */
    const thread =
      await expenseThreadsCol.findOne(
        {
          _id: new ObjectId(
            expenseThreadId
          )
        },
        { session }
      );

    if (!thread) {
      throw new Error(
        "Expense thread not found"
      );
    }

    const billAmount =
      Number(amount);

    const billDate =
      createdAt
        ? new Date(createdAt)
        : new Date();

    const billId =
      new ObjectId();

    /* ---------------------------------------------
       2️⃣ PREPARE BILL DOCUMENT
    --------------------------------------------- */
    const payload = {
      _id: billId,

      billName:
        billName.trim(),

      amount:
        billAmount,

      expenseThreadId:
        thread._id,

      expenseThreadName:
        thread.name,

      payment_details: {
        payment_method:
          payment_details
            ?.payment_method ||
          "",

        account_id:
          payment_details
            ?.account_id
            ? new ObjectId(
              payment_details.account_id
            )
            : null,

        paid_amount:
          paidAmount
      },

      remarks:
        remarks || "",

      createdAt:
        billDate,

      updatedAt:
        new Date()
    };

    /* ---------------------------------------------
       3️⃣ INSERT BILL
    --------------------------------------------- */
    await billsCol.insertOne(
      payload,
      { session }
    );

    /* ---------------------------------------------
       4️⃣ UPDATE THREAD TOTAL COST
    --------------------------------------------- */
    await expenseThreadsCol.updateOne(
      {
        _id: thread._id
      },
      {
        $inc: {
          total_cost:
            billAmount
        }
      },
      { session }
    );

    /* ---------------------------------------------
       5️⃣ DEBIT ACCOUNT
    --------------------------------------------- */
    if (
      paidAmount > 0 &&
      payload
        .payment_details
        .account_id
    ) {
      const paymentResult =
        await updateAccountBalance(
          {
            client, db,
            session, amount:
              paidAmount,
            transactionType:
              "debit",
            entrySource:
              "bill_create",

            bill_id:
              billId,

            accountId:
              payload
                .payment_details
                .account_id
          }
        );

      if (
        !paymentResult.success
      ) {
        throw new Error(
          paymentResult.message
        );
      }

      /* ---------------------------------------------
         6️⃣ CREATE TRANSACTION RECORD
      --------------------------------------------- */
      await transactionCol.insertOne(
        {
          date:
            billDate,

          time:
            billDate.toLocaleTimeString(
              "en-GB",
              {
                hour12:
                  false
              }
            ),

          account_id:
            payload
              .payment_details
              .account_id,

          account_type:
            payload
              .payment_details
              .payment_method ||
            "",

          entry_source:
            "bill_create",

          transaction_type:
            "debit",

          amount:
            paidAmount,

          payment_details:
          {
            payment_method:
              payload
                .payment_details
                .payment_method,

            paid_amount:
              paidAmount
          },

          products:
            [],

          reference_id:
            billId,

          created_by:
            req.user
              ?.role ||
            req.user
              ?.name ||
            "admin",

          remarks:
            remarks ||
            "",

          bill_details:
          {
            bill_name:
              payload.billName,

            expense_thread_id:
              thread._id,

            expense_thread_name:
              thread.name,

            total_bill_amount:
              billAmount
          }
        },
        { session }
      );
    }

    /* ---------------------------------------------
       COMMIT TRANSACTION
    --------------------------------------------- */
    await session.commitTransaction();

    return res.status(201).json({
      success: true,
      message:
        "Bill created successfully",
      data: payload
    });
  } catch (error) {
    await session.abortTransaction();

    console.error(
      "CREATE BILL ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "Failed to create bill"
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

    const {
      billName,
      amount,
      expenseThreadId,
      payment_details,
      remarks,
      createdAt
    } = req.body;

    /* --------------------------------------------------
       VALIDATE BILL ID
    -------------------------------------------------- */
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid bill ID"
      });
    }

    /* --------------------------------------------------
       VALIDATE THREAD ID IF PROVIDED
    -------------------------------------------------- */
    if (
      expenseThreadId &&
      !ObjectId.isValid(expenseThreadId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid expense thread ID"
      });
    }

    /* --------------------------------------------------
       VALIDATE ACCOUNT ID IF PROVIDED
    -------------------------------------------------- */
    if (
      payment_details?.account_id &&
      !ObjectId.isValid(
        payment_details.account_id
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid account ID"
      });
    }

    /* --------------------------------------------------
       VALIDATE DATE IF PROVIDED
    -------------------------------------------------- */
    if (
      createdAt &&
      isNaN(new Date(createdAt).getTime())
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid date"
      });
    }

    await session.startTransaction();

    /* --------------------------------------------------
       FETCH EXISTING BILL
    -------------------------------------------------- */
    const existingBill =
      await billsCol.findOne(
        {
          _id: new ObjectId(id)
        },
        { session }
      );

    if (!existingBill) {
      throw new Error("Bill not found");
    }

    /* --------------------------------------------------
       OLD VALUES
    -------------------------------------------------- */
    const oldAmount =
      Number(existingBill.amount);

    const oldThreadId =
      existingBill.expenseThreadId;

    const oldThreadName =
      existingBill.expenseThreadName;

    const oldPaidAmount =
      Number(
        existingBill.payment_details
          ?.paid_amount || 0
      );

    const oldAccountId =
      existingBill.payment_details
        ?.account_id || null;

    /* --------------------------------------------------
       NEW VALUES
    -------------------------------------------------- */
    const newAmount =
      amount !== undefined
        ? Number(amount)
        : oldAmount;

    const newThreadId =
      expenseThreadId
        ? new ObjectId(expenseThreadId)
        : oldThreadId;

    const newPaidAmount =
      payment_details
        ? Number(
          payment_details.paid_amount || 0
        )
        : oldPaidAmount;

    const newAccountId =
      payment_details?.account_id
        ? new ObjectId(
          payment_details.account_id
        )
        : oldAccountId;

    /* --------------------------------------------------
       FETCH NEW THREAD IF CHANGED
    -------------------------------------------------- */
    let newThreadName =
      oldThreadName;

    if (expenseThreadId) {
      const thread =
        await expenseThreadsCol.findOne(
          {
            _id: newThreadId
          },
          { session }
        );

      if (!thread) {
        throw new Error(
          "Expense thread not found"
        );
      }

      newThreadName =
        thread.name;
    }

    /* --------------------------------------------------
       UPDATE THREAD TOTAL COST
    -------------------------------------------------- */

    const threadChanged =
      !oldThreadId.equals(
        newThreadId
      );

    if (threadChanged) {

      // Remove old amount from old thread

      await expenseThreadsCol.updateOne(
        {
          _id: oldThreadId
        },
        {
          $inc: {
            total_cost: -oldAmount
          }
        },
        { session }
      );

      // Add new amount to new thread

      await expenseThreadsCol.updateOne(
        {
          _id: newThreadId
        },
        {
          $inc: {
            total_cost: newAmount
          }
        },
        { session }
      );

    } else if (
      oldAmount !== newAmount
    ) {

      // Same thread, update only difference

      await expenseThreadsCol.updateOne(
        {
          _id: oldThreadId
        },
        {
          $inc: {
            total_cost:
              newAmount -
              oldAmount
          }
        },
        { session }
      );
    }

    /* --------------------------------------------------
       HANDLE ACCOUNT BALANCE CHANGES
    -------------------------------------------------- */

    const accountChanged =
      String(oldAccountId) !==
      String(newAccountId);

    const paymentDifference =
      newPaidAmount -
      oldPaidAmount;

    /* --------------------------------------------------
       ACCOUNT CHANGED
    -------------------------------------------------- */

    if (accountChanged) {

      // Refund old account

      if (
        oldPaidAmount > 0 &&
        oldAccountId
      ) {
        const refundResult =
          await updateAccountBalance({
            client,
            db,
            session,

            amount:
              oldPaidAmount,

            transactionType:
              "credit",

            entrySource:
              "bill_update",

            bill_id:
              existingBill._id,

            accountId:
              oldAccountId,

            details: {
              remarks:
                `bill ${existingBill._id} is updated, amount ${oldPaidAmount} to ${newPaidAmount}`,
            },
          });

        if (
          !refundResult.success
        ) {
          throw new Error(
            refundResult.message
          );
        }
      }

      // Debit new account

      if (
        newPaidAmount > 0 &&
        newAccountId
      ) {
        const debitResult =
          await updateAccountBalance({
            client,
            db,
            session,

            amount:
              newPaidAmount,

            transactionType:
              "debit",

            entrySource:
              "bill_update",

            bill_id:
              existingBill._id,

            accountId:
              newAccountId
          });

        if (
          !debitResult.success
        ) {
          throw new Error(
            debitResult.message
          );
        }
      }
    }

    /* --------------------------------------------------
       SAME ACCOUNT BUT PAYMENT CHANGED
    -------------------------------------------------- */

    else if (
      paymentDifference !== 0 &&
      newAccountId
    ) {

      // User increased payment

      if (
        paymentDifference > 0
      ) {

        const debitResult =
          await updateAccountBalance({
            client,
            db,
            session,

            amount:
              paymentDifference,

            transactionType:
              "debit",

            entrySource:
              "bill_update",

            bill_id:
              existingBill._id,

            details: {
              remarks:
                `bill ${existingBill._id} is updated, amount ${oldPaidAmount} to ${newPaidAmount}`,
            },

            accountId:
              newAccountId
          });

        if (
          !debitResult.success
        ) {
          throw new Error(
            debitResult.message
          );
        }

      } else {

        // User reduced payment

        const refundResult =
          await updateAccountBalance({
            client,
            db,
            session,

            amount:
              Math.abs(
                paymentDifference
              ),

            transactionType:
              "credit",

            entrySource:
              "bill_update",

            bill_id:
              existingBill._id,

            accountId:
              newAccountId,

            details: {
              remarks:
                `bill ${existingBill._id} is updated, amount ${oldPaidAmount} to ${newPaidAmount}`,
            },
          });

        if (
          !refundResult.success
        ) {
          throw new Error(
            refundResult.message
          );
        }
      }
    }

    /* --------------------------------------------------
       PREPARE BILL UPDATE DOCUMENT
    -------------------------------------------------- */

    const updateDoc = {
      $set: {

        ...(billName && {
          billName:
            billName.trim()
        }),

        ...(amount !== undefined && {
          amount: newAmount
        }),

        ...(expenseThreadId && {
          expenseThreadId:
            newThreadId,

          expenseThreadName:
            newThreadName
        }),

        ...(payment_details && {
          payment_details: {
            payment_method:
              payment_details.payment_method ||
              "",

            account_id:
              newAccountId,

            paid_amount:
              newPaidAmount
          }
        }),

        ...(remarks !== undefined && {
          remarks
        }),

        ...(createdAt && {
          createdAt:
            new Date(createdAt)
        }),

        updatedAt:
          new Date()
      }
    };

    /* --------------------------------------------------
       UPDATE BILL
    -------------------------------------------------- */

    await billsCol.updateOne(
      {
        _id:
          existingBill._id
      },
      updateDoc,
      { session }
    );

    /* --------------------------------------------------
       UPDATE RELATED TRANSACTION
    -------------------------------------------------- */

    await transactionCol.updateOne(
      {
        reference_id:
          existingBill._id,

        entry_source:
          "bill_create"
      },
      {
        $set: {

          amount:
            newPaidAmount,

          account_id:
            newAccountId,

          account_type:
            payment_details
              ?.payment_method ||
            existingBill
              .payment_details
              ?.payment_method ||
            "",

          remarks:
            remarks ??
            existingBill.remarks,

          updatedAt:
            new Date(),

          bill_details: {
            bill_name:
              billName ||
              existingBill.billName,

            expense_thread_id:
              newThreadId,

            expense_thread_name:
              newThreadName,

            total_bill_amount:
              newAmount
          }
        }
      },
      { session }
    );

    /* --------------------------------------------------
       COMMIT TRANSACTION
    -------------------------------------------------- */

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message:
        "Bill updated successfully"
    });

  } catch (error) {

    await session.abortTransaction();

    console.error(
      "UPDATE BILL ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "Failed to update bill"
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

    /* --------------------------------------------------
       VALIDATE BILL ID
    -------------------------------------------------- */
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid bill ID"
      });
    }

    await session.startTransaction();

    /* --------------------------------------------------
       FETCH BILL
    -------------------------------------------------- */
    const bill = await billsCol.findOne(
      {
        _id: new ObjectId(id)
      },
      { session }
    );

    if (!bill) {
      throw new Error("Bill not found");
    }

    /* --------------------------------------------------
       EXTRACT PAYMENT INFORMATION
    -------------------------------------------------- */

    const paidAmount = Number(
      bill.payment_details?.paid_amount || 0
    );

    const accountId =
      bill.payment_details?.account_id || null;

    /* --------------------------------------------------
       REVERSE ACCOUNT BALANCE

       Example:

       Bill Paid = 500

       During Create:
       Cash = -500

       During Delete:
       Cash = +500
    -------------------------------------------------- */

    if (
      paidAmount > 0 &&
      accountId
    ) {
      const reverseResult =
        await updateAccountBalance({
          client,
          db,
          session,

          amount: paidAmount,

          transactionType: "credit",

          entrySource: "bill_delete",

          bill_id: bill._id,

          accountId
        });

      if (!reverseResult.success) {
        throw new Error(
          reverseResult.message
        );
      }
    }

    /* --------------------------------------------------
       DELETE RELATED TRANSACTION

       Remove bill payment transaction
       created during bill creation.
    -------------------------------------------------- */

    await transactionCol.deleteOne(
      {
        reference_id: bill._id,
        entry_source: "bill_create"
      },
      { session }
    );

    /* --------------------------------------------------
       DECREASE THREAD TOTAL COST

       Example:

       Thread Total = 10000
       Bill Amount = 500

       Result:

       Thread Total = 9500
    -------------------------------------------------- */

    await expenseThreadsCol.updateOne(
      {
        _id: bill.expenseThreadId
      },
      {
        $inc: {
          total_cost:
            -Number(bill.amount)
        }
      },
      { session }
    );

    /* --------------------------------------------------
       DELETE BILL
    -------------------------------------------------- */

    const deleteResult =
      await billsCol.deleteOne(
        {
          _id: bill._id
        },
        { session }
      );

    if (
      deleteResult.deletedCount === 0
    ) {
      throw new Error(
        "Failed to delete bill"
      );
    }

    /* --------------------------------------------------
       COMMIT TRANSACTION
    -------------------------------------------------- */

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message:
        "Bill deleted successfully"
    });

  } catch (error) {

    /* --------------------------------------------------
       ROLLBACK EVERYTHING
    -------------------------------------------------- */

    await session.abortTransaction();

    console.error(
      "DELETE BILL ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "Failed to delete bill"
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
