const { ObjectId } = require("mongodb");
const { client, db } = require("../db.js");
const { updateAccountBalance } = require("../services/accountBalance.service.js");
const { increaseInventoryStock, decreaseInventoryStock, addToInventory, recalculateAveragePurchasePrice } = require("../services/inventory.service.js");
const { extractProductId, normalizeIdV2 } = require("../utils/id.util.js");

const purchasesCol = db.collection("purchases");
const inventoryCol = db.collection("inventory");
const suppliersCol = db.collection("suppliers");


// -------------------- GET PURCHASES --------------------
async function getPurchases(req, res) {
  console.log("hit getPurchases");

  try {
    const { type } = req.query;

    /* -----------------------------------------
       FILTER: ONLY DUE PURCHASES (optional)
       ?type=due
    ----------------------------------------- */
    const matchStage =
      type === "due"
        ? { payment_due: { $gt: 0 } }
        : {};

    /* -----------------------------------------
       AGGREGATION PIPELINE
    ----------------------------------------- */
    const purchases = await purchasesCol.aggregate([
      { $match: matchStage },

      /* -------------------------------------
         JOIN SUPPLIER COLLECTION
      ------------------------------------- */
      {
        $lookup: {
          from: "suppliers",
          localField: "supplier_id",
          foreignField: "_id",
          as: "supplier"
        }
      },

      /* -------------------------------------
         FLATTEN SUPPLIER ARRAY
      ------------------------------------- */
      {
        $unwind: {
          path: "$supplier",
          preserveNullAndEmptyArrays: true
        }
      },

      /* -------------------------------------
         SHAPE FINAL RESPONSE
      ------------------------------------- */
      {
        $addFields: {
          supplier_name: "$supplier.name"
        }
      },

      /* -------------------------------------
         REMOVE EXTRA DATA
      ------------------------------------- */
      {
        $project: {
          supplier: 0
        }
      },

      /* -------------------------------------
         SORT BY DATE
      ------------------------------------- */
      {
        $sort: { date: -1 }
      }
    ]).toArray();

    res.status(200).json({
      success: true,
      count: purchases.length,
      data: purchases
    });

  } catch (err) {
    console.error("getPurchases error:", err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
}




async function getPurchaseReport(req, res) {
  try {
    const { type } = req.params;
    const { date, month, year, from, to, dueOnly } = req.query;

    let matchQuery = {};

    /* ------------------------------
       DAILY REPORT
    ------------------------------ */
    if (type === "daily") {
      if (!date) return res.status(400).json({ success: false, message: "Date is required" });
      const start = new Date(date);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setUTCHours(23, 59, 59, 999);

      console.log("daily", start, end);
      matchQuery.date = { $gte: start, $lte: end };
    }

    /* ------------------------------
       MONTHLY REPORT
    ------------------------------ */
    else if (type === "monthly") {
      const numMonth = Number(month);
      const numYear = Number(year);
      if (!numMonth || !numYear) return res.status(400).json({ success: false, message: "Month and year are required" });

      const start = new Date(Date.UTC(numYear, numMonth - 1, 1, 0, 0, 0));
      const end = new Date(Date.UTC(numYear, numMonth, 0, 23, 59, 59, 999)); // last day of month
      console.log("monthly", start, end);
      matchQuery.date = { $gte: start, $lte: end };
    }

    /* ------------------------------
       YEARLY REPORT
    ------------------------------ */
    else if (type === "yearly") {
      const numYear = Number(year);
      if (!numYear) return res.status(400).json({ success: false, message: "Year is required" });

      const start = new Date(Date.UTC(numYear, 0, 1, 0, 0, 0));
      const end = new Date(Date.UTC(numYear, 11, 31, 23, 59, 59, 999));
      console.log("yearly", start, end);
      matchQuery.date = { $gte: start, $lte: end };
    }

    /* ------------------------------
       CUSTOM RANGE REPORT
    ------------------------------ */
    else if (type === "range") {
      if (!from || !to) return res.status(400).json({ success: false, message: "From and To dates are required" });

      const start = new Date(from);
      start.setUTCHours(0, 0, 0, 0);

      const end = new Date(to);
      end.setUTCHours(23, 59, 59, 999);

      console.log("custom", start, end);
      matchQuery.date = { $gte: start, $lte: end };
    }

    else return res.status(400).json({ success: false, message: "Invalid report type" });

    /* ------------------------------
       ONLY DUE PURCHASES
    ------------------------------ */
    if (dueOnly === "true") matchQuery.payment_due = { $gt: 0 };

    /* ------------------------------
       FETCH PURCHASES
    ------------------------------ */
    const purchases = await purchasesCol.find(matchQuery).sort({ date: -1 }).toArray();

    /* ------------------------------
       NORMALIZE DATES
    ------------------------------ */
    const normalizedPurchases = purchases.map(p => ({
      ...p,
      date: p.date ? p.date.toISOString() : null,
      last_payment_date: p.last_payment_date ? p.last_payment_date.toISOString() : null,
      updated_at: p.updated_at ? p.updated_at.toISOString() : null,
    }));

    /* ------------------------------
       SUMMARY
    ------------------------------ */
    const totalAmount = normalizedPurchases.reduce((sum, p) => sum + (p.total_amount || 0), 0);
    const totalPaid = normalizedPurchases.reduce((sum, p) => sum + (p.paid_amount || 0), 0);
    const totalDue = normalizedPurchases.reduce((sum, p) => sum + (p.payment_due || 0), 0);

    res.status(200).json({
      success: true,
      count: normalizedPurchases.length,
      summary: { totalAmount, totalPaid, totalDue },
      data: normalizedPurchases,
    });

  } catch (err) {
    console.error("getPurchaseReport error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}




// -------------------- GET SINGLE PURCHASE --------------------
async function getPurchaseById(req, res) {
  const purchase_id = req.params.id;
  if (!purchase_id) return res.json({ success: false, message: 'purchase id not found' });
  try {
    const purchase = await purchasesCol.findOne({ _id: new ObjectId(purchase_id) });
    if (!purchase) return res.status(404).json({ success: false, message: "Purchase not found" });
    res.status(200).json({ success: true, data: purchase });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getPurchasesBySupplierId(req, res) {
  const { supplierId } = req.params;
  if (!supplierId) return res.json({ success: false, message: 'Supplier id not found' });
  try {
    const purchases = await purchasesCol.find({
      supplier_id: new ObjectId(supplierId)
    }).toArray();
    res.status(200).json({ success: true, data: purchases });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}


async function createPurchase(req, res) {
  const session = client.startSession();

  try {
    const { products, total_amount, paid_amount = 0, payment_method = "cash", account_id, supplier_id, date } = req.body;
    console.log(req.body);
    if (!products || !products.length) return res.status(400).json({ success: false, message: "Products array cannot be empty" });
    if (paid_amount > 0 && !account_id) return res.status(400).json({ success: false, message: "Account selection is required for payment" });
    if (!date) return res.status(400).json({ success: false, message: "Date is invalid." });
    // return res.status(400).json({ success: false, message: "Date is invalddddddid." });

    // Parse date properly
    let purchaseDate;
    if (date) {
      purchaseDate = new Date(date);
      if (isNaN(purchaseDate.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid date format" });
      }
    } else {
      purchaseDate = new Date(); // default to current date and time
    }

    const invoice_id = new ObjectId();
    const payment_due = total_amount - paid_amount;

    await session.startTransaction();

    // Insert purchase
    await purchasesCol.insertOne({
      _id: invoice_id,
      supplier_id: supplier_id ? new ObjectId(supplier_id) : null,
      products,
      total_amount,
      paid_amount,
      payment_due,
      payment_method,
      account_id: paid_amount > 0 ? new ObjectId(account_id) : null,
      date: purchaseDate,
    }, { session });

    // Handle payment (debit account)
    if (paid_amount > 0) {
      const paymentResult = await updateAccountBalance({
        client,
        db,
        amount: paid_amount,
        transactionType: "debit",
        entrySource: "purchase",
        accountId: account_id,
        details: { invoiceId: invoice_id }
      });
      if (!paymentResult.success) throw new Error(paymentResult.message);
    }

    // Update inventory
    for (const product of products) {
      const result = await addToInventory(product, invoice_id, session);
      console.log('inventory result', result);
      if (!result.success) throw new Error(result.message);
    }

    // Update supplier
    if (supplier_id) {
      const supplierObjId = new ObjectId(supplier_id);
      const balanceDiff = total_amount - paid_amount; // positive due or negative advance
      const advanceDiff = paid_amount > total_amount ? paid_amount - total_amount : 0;
      const dueDiff = balanceDiff > 0 ? balanceDiff : 0;

      await suppliersCol.updateOne(
        { _id: supplierObjId },
        {
          $inc: { total_purchase: total_amount, total_due: dueDiff, due: dueDiff, advance: advanceDiff },
          $set: { last_purchase_date: purchaseDate },
          $push: {
            supplier_history: {
              date: purchaseDate,
              type: "purchase",
              purchase_id: invoice_id,
              products,
              total_amount,
              paid_amount,
              due_after_payment: total_amount - paid_amount,
              remarks: "New purchase created"
            }
          }
        },
        { session }
      );
    }

    await session.commitTransaction();
    return res.status(201).json({ success: true, message: "Purchase processed successfully", invoiceId: invoice_id });

  } catch (err) {
    await session.abortTransaction();
    console.error("Purchase transaction failed:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    await session.endSession();
  }
}


/**
 * UPDATE PURCHASE
 * ----------------
 * This controller:
 * 1. Detects changes between old & new purchase data
 * 2. Updates inventory only by the quantity difference
 * 3. Reverts old payment and applies new payment safely
 * 4. Supports payment method / account change
 * 5. Runs everything inside a MongoDB transaction
 */
// async function updatePurchase(req, res) {
//   const session = client.startSession();

//   try {
//     const purchaseId = new ObjectId(req.params.id);
//     const payload = req.body;
//     // console.log("payload", payload);
//     // return res.status(404).json({ success: false, message: "Purchase not found" });
//     console.log("➡️ Update purchase called:", purchaseId.toString());
//     console.log("📦 Incoming payload products:", payload.products);
//     await session.startTransaction();
//     console.log("✅ Transaction started");

//     /* --------------------------------------------------
//        1️⃣ FETCH EXISTING PURCHASE
//     -------------------------------------------------- */
//     const existingPurchase = await purchasesCol.findOne(
//       { _id: purchaseId },
//       { session }
//     );

//     console.log("📄 Existing purchase:", existingPurchase);

//     if (!existingPurchase) {
//       console.log("❌ Purchase not found");
//       return res.status(404).json({ success: false, message: "Purchase not found" });
//     }
//     // new inventory adjustment (avg pur price)

//     // 🔁 CHANGE: revert old purchase completely
//     for (const oldProd of existingPurchase.products) {
//       await inventoryCol.updateOne(
//         { product_id: new ObjectId(oldProd.product_id) },
//         {
//           $inc: { stock_qty: -oldProd.qty },
//           $pull: {
//             purchase_history: { invoice_id: purchaseId.toString() }
//           }
//         },
//         { session }
//       );

//       // 🔁 CHANGE: recalc after removal
//       await recalculateAveragePurchasePrice(oldProd.product_id, session);
//     }

//     // 🔁 CHANGE: apply updated purchase
//     const newProducts = payload.products;
//     for (const newProd of newProducts) {
//       const purchaseRecord = {
//         invoice_id: purchaseId.toString(),
//         qty: newProd.qty,
//         purchase_price: newProd.purchase_price,
//         subtotal: newProd.subtotal,
//         date: new Date()
//       };

//       await inventoryCol.updateOne(
//         { product_id: new ObjectId(newProd.product_id) },
//         {
//           $inc: { stock_qty: newProd.qty },
//           $push: { purchase_history: purchaseRecord }
//         },
//         { upsert: true, session }
//       );

//       // 🔁 CHANGE: recalc after add
//       await recalculateAveragePurchasePrice(newProd.product_id, session);
//     }

//     /* --------------------------------------------------
//    2️⃣ INVENTORY ADJUSTMENT (USING SERVICES)
// -------------------------------------------------- */

//     // const oldMap = new Map();
//     // existingPurchase.products.forEach(p => {
//     //   oldMap.set(p.product_id.toString(), p);
//     // });

//     // const newMap = new Map();
//     // payload.products.forEach(p => {
//     //   newMap.set(p.product_id.toString(), p);
//     // });

//     // /* -------------------------------
//     //    Added or updated products
//     // -------------------------------- */
//     // for (const [productId, newProd] of newMap) {
//     //   const oldProd = oldMap.get(productId);

//     //   if (!oldProd) {
//     //     // ➕ Newly added product
//     //     const inc = await increaseInventoryStock({
//     //       product_id: productId,
//     //       qty: newProd.qty
//     //     });

//     //     if (!inc.success) throw new Error(inc.message);

//     //   } else {
//     //     const diff = newProd.qty - oldProd.qty;

//     //     if (diff > 0) {
//     //       const inc = await increaseInventoryStock({
//     //         product_id: productId,
//     //         qty: diff
//     //       });
//     //       if (!inc.success) throw new Error(inc.message);

//     //     } else if (diff < 0) {
//     //       const dec = await decreaseInventoryStock({
//     //         product_id: productId,
//     //         qty: Math.abs(diff)
//     //       });
//     //       if (!dec.success) throw new Error(dec.message);
//     //     }
//     //   }
//     // }

//     // /* -------------------------------
//     //    Removed products
//     // -------------------------------- */
//     // for (const [productId, oldProd] of oldMap) {
//     //   if (!newMap.has(productId)) {
//     //     const dec = await decreaseInventoryStock({
//     //       product_id: productId,
//     //       qty: oldProd.qty
//     //     });
//     //     if (!dec.success) throw new Error(dec.message);
//     //   }
//     // }



//     /* --------------------------------------------------
//        3️⃣ ACCOUNT BALANCE ADJUSTMENT
//     -------------------------------------------------- */
//     const oldPaid = existingPurchase.paid_amount || 0;
//     const newPaid = payload.paid_amount || 0;

//     console.log("💰 Old paid:", oldPaid);
//     console.log("💰 New paid:", newPaid);

//     if (oldPaid > 0 && existingPurchase.account_id) {
//       console.log("🔄 Reverting old payment");

//       await updateAccountBalance({
//         client,
//         db,
//         amount: oldPaid,
//         transactionType: "credit",
//         entrySource: "purchase_update",
//         accountId: existingPurchase.account_id.toString(),
//         details: existingPurchase
//       });
//     }

//     if (newPaid > 0 && payload.account_id) {
//       console.log("💸 Applying new payment");

//       await updateAccountBalance({
//         client,
//         db,
//         amount: newPaid,
//         transactionType: "debit",
//         entrySource: "purchase_update",
//         accountId: payload.account_id,
//         details: payload
//       });
//     }

//     /* --------------------------------------------------
//        4️⃣ SUPPLIER DUE ADJUSTMENT
//     -------------------------------------------------- */
//     const suppliersCol = db.collection("suppliers");

//     const oldTotal = existingPurchase.total_amount;
//     const newTotal = payload.total_amount;

//     const oldDue = oldTotal - oldPaid;
//     const newDue = newTotal - newPaid;

//     const dueDiff = newDue - oldDue;
//     const purchaseDiff = newTotal - oldTotal;

//     console.log("🏭 Supplier due diff:", dueDiff);
//     console.log("🏭 Supplier purchase diff:", purchaseDiff);

//     await suppliersCol.updateOne(
//       { _id: new ObjectId(payload.supplier_id) },
//       {
//         $inc: {
//           due: dueDiff,
//           total_due: dueDiff,
//           total_purchase: purchaseDiff
//         },
//         $set: {
//           last_purchase_date: new Date(),
//           updatedAt: new Date()
//         }
//       },
//       { session }
//     );

//     /* --------------------------------------------------
//        5️⃣ UPDATE SUPPLIER HISTORY ENTRY
//     -------------------------------------------------- */
//     console.log("📝 Updating supplier history");

//     await suppliersCol.updateOne(
//       {
//         _id: new ObjectId(payload.supplier_id),
//         "supplier_history.purchase_id": purchaseId
//       },
//       {
//         $set: {
//           "supplier_history.$.products": payload.products,
//           "supplier_history.$.total_amount": newTotal,
//           "supplier_history.$.paid_amount": newPaid,
//           "supplier_history.$.due_after_payment": newDue,
//           "supplier_history.$.date": new Date(),
//           "supplier_history.$.remarks": "Purchase updated"
//         }
//       },
//       { session }
//     );

//     /* --------------------------------------------------
//        6️⃣ UPDATE PURCHASE DOCUMENT
//     -------------------------------------------------- */

//     // Parse date properly
//     let purchaseDate;
//     if (payload.date) {
//       purchaseDate = new Date(payload.date);
//       if (isNaN(purchaseDate.getTime())) {
//         return res.status(400).json({ success: false, message: "Invalid date format" });
//       }
//     } else {
//       purchaseDate = new Date(); // default to current date and time
//     }


//     console.log("📄 Updating purchase document");

//     //     await purchasesCol.updateOne(
//     //   { _id: new ObjectId(purchaseId) },
//     //   { $set: req.body },
//     //   { session }
//     // );

//     await purchasesCol.updateOne(
//       { _id: purchaseId },
//       {
//         $set: {
//           products: payload.products,
//           total_amount: newTotal,
//           paid_amount: newPaid,
//           payment_due: newDue,
//           payment_method: payload.payment_method,
//           account_id: payload.account_id ? new ObjectId(payload.account_id) : null,
//           last_payment_date: new Date(),
//           updated_at: new Date(),
//           date: purchaseDate,
//         }
//       },
//       { session }
//     );

//     await session.commitTransaction();
//     console.log("✅ Transaction committed");

//     res.status(200).json({
//       success: true,
//       message: "Purchase updated successfully"
//     });

//   } catch (error) {
//     await session.abortTransaction();
//     console.error("❌ Purchase update failed:", error);
//     res.status(500).json({ success: false, message: error.message });
//   } finally {
//     session.endSession();
//     console.log("🧹 Session ended");
//   }
// }


async function updatePurchase(req, res) {
  const session = client.startSession();

  try {
    console.log("====================================");
    console.log("🚀 UPDATE PURCHASE START");
    console.log("====================================");

    console.log("📥 Params ID:", req.params.id);
    console.log("📥 Payload:", JSON.stringify(req.body, null, 2));

    const purchaseId = normalizeIdV2(req.params.id, "purchaseId");
    const payload = req.body;

    await session.startTransaction();
    console.log("✅ Transaction started");

    /* -------------------------------------------------- */
    /* 1️⃣ FETCH EXISTING PURCHASE */
    /* -------------------------------------------------- */

    const existingPurchase = await purchasesCol.findOne(
      { _id: purchaseId },
      { session }
    );

    console.log("📄 Existing Purchase Found:", !!existingPurchase);

    if (!existingPurchase) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Purchase not found"
      });
    }

    /* -------------------------------------------------- */
    /* 2️⃣ REVERT OLD INVENTORY */
    /* -------------------------------------------------- */

    for (const oldProd of existingPurchase.products) {
      console.log("🔄 Reverting product:", oldProd);

      const productId = normalizeIdV2(oldProd.product_id, "old product_id");

      await inventoryCol.updateOne(
        { product_id: productId },
        {
          $inc: { stock_qty: -oldProd.qty },
          $pull: {
            purchase_history: { invoice_id: purchaseId.toString() }
          }
        },
        { session }
      );

      await recalculateAveragePurchasePrice(productId, session);
    }

    /* -------------------------------------------------- */
    /* 3️⃣ APPLY NEW INVENTORY */
    /* -------------------------------------------------- */

    if (!Array.isArray(payload.products) || payload.products.length === 0) {
      throw new Error("Products array is empty or invalid");
    }

    for (const newProd of payload.products) {
      console.log("➕ Applying product:", newProd);

      const productId = normalizeIdV2(newProd.product_id, "new product_id");

      const purchaseRecord = {
        invoice_id: purchaseId.toString(),
        qty: newProd.qty,
        purchase_price: newProd.purchase_price,
        subtotal: newProd.subtotal,
        date: new Date()
      };

      await inventoryCol.updateOne(
        { product_id: productId },
        {
          $inc: { stock_qty: newProd.qty },
          $push: { purchase_history: purchaseRecord }
        },
        { upsert: true, session }
      );

      await recalculateAveragePurchasePrice(productId, session);
    }

    /* -------------------------------------------------- */
    /* 4️⃣ ACCOUNT BALANCE */
    /* -------------------------------------------------- */

    const oldPaid = existingPurchase.paid_amount || 0;
    const newPaid = payload.paid_amount || 0;

    if (oldPaid > 0 && existingPurchase.account_id) {
      console.log("🔄 Reverting old payment");

      await updateAccountBalance({
        client,
        db,
        amount: oldPaid,
        transactionType: "credit",
        entrySource: "purchase_update",
        accountId: existingPurchase.account_id.toString(),
        details: existingPurchase
      });
    }

    if (newPaid > 0 && payload.account_id) {
      console.log("💸 Applying new payment");

      const accountId = normalizeIdV2(payload.account_id, "account_id");

      await updateAccountBalance({
        client,
        db,
        amount: newPaid,
        transactionType: "debit",
        entrySource: "purchase_update",
        accountId: accountId.toString(),
        details: payload
      });
    }

    /* -------------------------------------------------- */
    /* 5️⃣ SUPPLIER UPDATE */
    /* -------------------------------------------------- */

    const suppliersCol = db.collection("suppliers");
    const supplierId = normalizeIdV2(payload.supplier_id, "supplier_id");

    const oldTotal = existingPurchase.total_amount;
    const newTotal = payload.total_amount;

    const oldDue = oldTotal - oldPaid;
    const newDue = newTotal - newPaid;

    const dueDiff = newDue - oldDue;
    const purchaseDiff = newTotal - oldTotal;

    await suppliersCol.updateOne(
      { _id: supplierId },
      {
        $inc: {
          due: dueDiff,
          total_due: dueDiff,
          total_purchase: purchaseDiff
        },
        $set: {
          last_purchase_date: new Date(),
          updatedAt: new Date()
        }
      },
      { session }
    );

    /* -------------------------------------------------- */
    /* 6️⃣ SUPPLIER HISTORY */
    /* -------------------------------------------------- */

    await suppliersCol.updateOne(
      {
        _id: supplierId,
        "supplier_history.purchase_id": purchaseId
      },
      {
        $set: {
          "supplier_history.$.products": payload.products,
          "supplier_history.$.total_amount": newTotal,
          "supplier_history.$.paid_amount": newPaid,
          "supplier_history.$.due_after_payment": newDue,
          "supplier_history.$.date": new Date(),
          "supplier_history.$.remarks": "Purchase updated"
        }
      },
      { session }
    );

    /* -------------------------------------------------- */
    /* 7️⃣ UPDATE PURCHASE DOCUMENT */
    /* -------------------------------------------------- */

    let purchaseDate = new Date();
    if (payload.date) {
      const parsedDate = new Date(payload.date);
      if (isNaN(parsedDate.getTime())) {
        throw new Error("Invalid date format");
      }
      purchaseDate = parsedDate;
    }

    await purchasesCol.updateOne(
      { _id: purchaseId },
      {
        $set: {
          products: payload.products,
          total_amount: newTotal,
          paid_amount: newPaid,
          payment_due: newDue,
          payment_method: payload.payment_method,
          account_id: payload.account_id
            ? normalizeIdV2(payload.account_id, "account_id")
            : null,
          last_payment_date: new Date(),
          updated_at: new Date(),
          date: purchaseDate,
        }
      },
      { session }
    );

    /* -------------------------------------------------- */
    /* ✅ COMMIT */
    /* -------------------------------------------------- */

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: "Purchase updated successfully"
    });

  } catch (error) {
    console.error("❌ ERROR:", error.message);
    await session.abortTransaction();

    res.status(500).json({
      success: false,
      message: error.message
    });

  } finally {
    await session.endSession();
    console.log("🧹 Session ended");
  }
}




/* ======================
   CONTROLLER: paySupplierDue (unified accounts)
   ====================== */
async function paySupplierDue(req, res) {
  const purchaseId = new ObjectId(req.params.id);
  const { payAmount, paymentAccountId } = req.body;

  console.log("paySupplierDue", purchaseId, req.body);
  if (!payAmount || payAmount <= 0) return res.status(400).json({ success: false, message: "Invalid payment amount" });
  if (!paymentAccountId) return res.status(400).json({ success: false, message: "Payment account is required" });

  try {
    const purchase = await purchasesCol.findOne({ _id: purchaseId });
    if (!purchase) return res.status(404).json({ success: false, message: "Purchase not found" });

    const oldPaid = Number(purchase.paid_amount || 0);
    const total = Number(purchase.total_amount || 0);
    const due = total - oldPaid;

    // if (payAmount > due) return res.status(400).json({ success: false, message: "Payment exceeds due amount" });

    // Debit account
    const paymentResult = await updateAccountBalance({
      client,
      db,
      amount: payAmount,
      transactionType: "debit",
      entrySource: "supplier_due_payment",
      accountId: paymentAccountId,
      details: { invoiceId: purchaseId, remarks: `Supplier due payment for purchase ${purchaseId}` }
    });
    console.log("paymentResult", paymentResult);
    if (!paymentResult.success) return res.status(400).json(paymentResult);

    // Update purchase payment
    const updatedPaid = oldPaid + payAmount;
    const newDue = total - updatedPaid;

    await purchasesCol.updateOne(
      { _id: purchaseId },
      {
        $set: { paid_amount: updatedPaid, payment_due: newDue, paymentAccountId, last_payment_date: new Date(), },
        $push: {
          payment_history: {
            date: new Date(),
            paymentAccountId,
            paid_amount: updatedPaid,
            due_after_payment: newDue,
            remarks: "Supplier Specific due payment"
          }
        }
      }
    );

    // Update supplier balances
    if (purchase.supplier_id) {
      const supplierId = new ObjectId(purchase.supplier_id);
      await suppliersCol.updateOne(
        { _id: supplierId },
        {
          $inc: { due: -payAmount, advance: 0, total_due: 0 },
          $set: { last_payment_date: new Date() },
          $push: {
            supplier_history: {
              date: new Date(),
              type: "payment",
              purchase_id: purchaseId,
              products: purchase.products,
              total_amount: total,
              paid_amount: updatedPaid,
              due_after_payment: newDue,
              remarks: "Supplier due payment"
            }
          }
        }
      );
    }

    const updatedPurchase = await purchasesCol.findOne({ _id: purchaseId });
    return res.status(200).json({ success: true, message: "Supplier due paid successfully", data: updatedPurchase });

  } catch (err) {
    console.error("paySupplierDue failed:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}


async function deletePurchase(req, res) {
  const session = client.startSession();

  try {
    console.log("🟢 DELETE PURCHASE HIT");
    console.log("📥 Params ID:", req.params.id);

    // 1️⃣ Validate purchaseId
    let purchaseId;
    try {
      purchaseId = new ObjectId(req.params.id);
      console.log("🆔 Converted purchaseId:", purchaseId);
    } catch (e) {
      console.log("❌ INVALID PURCHASE ID:", req.params.id);
      throw new Error("Invalid purchase ID format");
    }

    // 2️⃣ Fetch purchase
    console.log("🔍 Fetching purchase...");
    const existingPurchase = await purchasesCol.findOne({ _id: purchaseId });

    console.log("📄 Purchase found:", existingPurchase ? "YES" : "NO");
    console.log("📦 Products count:", existingPurchase?.products?.length);

    if (!existingPurchase) {
      console.log("❌ No purchase found in DB");
      return res.status(404).json({ success: false, message: "Purchase not found" });
    }

    await session.startTransaction();
    console.log("🔓 Transaction started");

    // 3️⃣ Inventory rollback
    console.log("🔁 Starting inventory rollback");

    for (const [index, item] of existingPurchase.products.entries()) {
      console.log(`\n➡️ ITEM ${index + 1}`);
      console.log("Raw item:", item);

      console.log("📦 item.product_id:", item.product_id);
      console.log("📦 item.qty:", item.qty);

      // ObjectId test
      // let productObjId;
      try {
        const productIdStr = extractProductId(item.product_id);

        if (!productIdStr) {
          console.log("❌ Cannot extract product id:", item.product_id);
          continue;
        }

        const productObjId = new ObjectId(productIdStr);

        // productObjId = new ObjectId(item.product_id);
        console.log("🆔 product ObjectId OK:", productObjId);
      } catch (e) {
        console.log("❌ INVALID product_id (NOT ObjectId):", item.product_id);
      }

      const productIdStr = extractProductId(item.product_id);

      if (!productIdStr) {
        console.log("❌ Skipping invalid product_id:", item.product_id);
        continue;
      }

      const productObjId = new ObjectId(productIdStr);

      const updateResult = await inventoryCol.updateOne(
        { product_id: productObjId },
        {
          $inc: { stock_qty: -item.qty },
          $pull: {
            purchase_history: { invoice_id: purchaseId.toString() }
          }
        },
        { session }
      );

      console.log("📊 Inventory update result:", updateResult);

      // avg recalculation debug
      console.log("🔄 Calling avg recalculation for:", item.product_id);
      await recalculateAveragePurchasePrice(item.product_id, session);
      console.log("✅ Avg recalculation done");
    }

    // 4️⃣ Payment rollback
    console.log("💰 Paid amount:", existingPurchase.paid_amount);
    console.log("🏦 Account ID:", existingPurchase.account_id);

    if (existingPurchase.paid_amount > 0 && existingPurchase.account_id) {
      console.log("🔁 Reverting payment...");

      const revertResult = await updateAccountBalance({
        client,
        db,
        amount: existingPurchase.paid_amount,
        transactionType: "credit",
        entrySource: "purchase_delete",
        accountId: existingPurchase.account_id,
        details: { invoiceId: purchaseId, remarks: "Revert payment on delete" }
      });

      console.log("💳 Payment revert result:", revertResult);

      if (!revertResult.success) throw new Error(revertResult.message);
    }

    // 5️⃣ Supplier update
    console.log("🏭 Supplier ID:", existingPurchase.supplier_id);

    if (existingPurchase.supplier_id) {
      const supplierObjId = new ObjectId(existingPurchase.supplier_id);

      const balanceDiff = existingPurchase.total_amount - existingPurchase.paid_amount;
      const advanceDiff = existingPurchase.paid_amount > existingPurchase.total_amount
        ? existingPurchase.paid_amount - existingPurchase.total_amount
        : 0;
      const dueDiff = balanceDiff > 0 ? balanceDiff : 0;

      console.log("📊 balanceDiff:", balanceDiff);
      console.log("📊 dueDiff:", dueDiff);
      console.log("📊 advanceDiff:", advanceDiff);

      const supplierUpdate = await suppliersCol.updateOne(
        { _id: supplierObjId },
        {
          $inc: {
            total_purchase: -existingPurchase.total_amount,
            total_due: -dueDiff,
            due: -dueDiff,
            advance: -advanceDiff
          },
          $set: { last_purchase_date: new Date() },
          $push: {
            supplier_history: {
              date: new Date(),
              type: "deleted_purchase",
              purchase_id: purchaseId,
              products: existingPurchase.products,
              total_amount: existingPurchase.total_amount,
              paid_amount: existingPurchase.paid_amount,
              due_after_payment: balanceDiff,
              remarks: "Purchase deleted"
            }
          }
        },
        { session }
      );

      console.log("🏭 Supplier update result:", supplierUpdate);
    }

    // 6️⃣ Delete purchase
    console.log("🗑️ Deleting purchase...");

    const deleteResult = await purchasesCol.deleteOne(
      { _id: purchaseId },
      { session }
    );

    console.log("🗑️ Delete result:", deleteResult);

    await session.commitTransaction();
    console.log("✅ Transaction committed");

    return res.status(200).json({
      success: true,
      message: "Purchase deleted successfully"
    });

  } catch (err) {
    console.log("❌ ERROR OCCURRED");
    console.log("Message:", err.message);
    console.log("Stack:", err.stack);

    await session.abortTransaction();
    return res.status(500).json({ success: false, message: err.message });

  } finally {
    await session.endSession();
    console.log("🔚 Session ended");
  }
}



async function paySupplierDueManually(req, res) {
  const session = client.startSession();
  console.log('hit paySupplierDueManually');
  try {
    const { paidAmount, paymentAccountId, supplierId } = req.body;

    if (!paidAmount || paidAmount <= 0)
      return res.status(400).json({ success: false, message: "Invalid payment amount" });

    if (!paymentAccountId)
      return res.status(400).json({ success: false, message: "Payment account is required" });

    if (!supplierId)
      return res.status(400).json({ success: false, message: "Supplier is required" });

    await session.startTransaction();

    let remainingAmount = Number(paidAmount);

    /* --------------------------------------------------
    1️⃣ Fetch supplier due purchases (oldest first)
    -------------------------------------------------- */
    const purchases = await purchasesCol
      .find({
        supplier_id: new ObjectId(supplierId),
        $expr: { $gt: ["$total_amount", "$paid_amount"] }
      })
      .sort({ date: 1 })
      .toArray();

    // return console.log("paySupplierDueManually", purchases);
    /* --------------------------------------------------
       2️⃣ Pay purchases step-by-step
    -------------------------------------------------- */
    for (const purchase of purchases) {
      if (remainingAmount <= 0) break;

      const total = Number(purchase.total_amount || 0);
      const paid = Number(purchase.paid_amount || 0);
      const due = total - paid;

      if (due <= 0) continue;

      const payNow = Math.min(due, remainingAmount);

      /* ---- Debit account ---- */
      const paymentResult = await updateAccountBalance({
        client,
        db,
        amount: payNow,
        transactionType: "debit",
        entrySource: "supplier_due_payment_manual",
        accountId: paymentAccountId,
        details: {
          purchaseId: purchase._id,
          remarks: `Manual supplier payment applied to purchase ${purchase._id}`
        },
        session
      });

      console.log("purchase paymentResult", paymentResult);

      if (!paymentResult.success) throw new Error(paymentResult.message);

      const newPaid = paid + payNow;
      const newDue = total - newPaid;

      /* ---- Update purchase ---- */
      await purchasesCol.updateOne(
        { _id: purchase._id },
        {
          $set: {
            paid_amount: newPaid,
            payment_due: newDue,
            paymentAccountId,
            last_payment_date: new Date()
          },
          $push: {
            payment_history: {
              date: new Date(),
              paymentAccountId,
              paid_amount: newPaid,
              due_after_payment: newDue,
              remarks: "Supplier Manual due payment"
            }
          }
        },
        { session }
      );

      /* ---- Update supplier ledger ---- */
      await suppliersCol.updateOne(
        { _id: new ObjectId(supplierId) },
        {
          $inc: { due: -payNow },
          $set: { last_payment_date: new Date() },
          $push: {
            supplier_history: {
              date: new Date(),
              type: "payment",
              purchase_id: purchase._id,
              products: purchase.products,
              total_amount: total,
              paid_amount: newPaid,
              due_after_payment: newDue,
              remarks: "Manual supplier due payment"
            }
          }
        },
        { session }
      );

      remainingAmount -= payNow;
    }

    /* --------------------------------------------------
       3️⃣ Remaining amount → supplier advance
    -------------------------------------------------- */
    if (remainingAmount > 0) {

      const paymentResult = await updateAccountBalance({
        client,
        db,
        amount: remainingAmount,
        transactionType: "debit",
        entrySource: "supplier_advance_payment_manual",
        accountId: paymentAccountId,
        details: {
          remarks: `Manual advance payment applied to supplier in purchase`
        },
        session
      });

      console.log("purchase paymentResult", paymentResult);

      if (!paymentResult.success) throw new Error(paymentResult.message);


      await suppliersCol.updateOne(
        { _id: new ObjectId(supplierId) },
        {
          $inc: { advance: remainingAmount }
        },
        { session }
      );
    }

    /* --------------------------------------------------
       ✅ Commit Transaction
    -------------------------------------------------- */
    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: "Supplier payment distributed successfully",
      summary: {
        totalPaid: paidAmount,
        appliedToDue: paidAmount - remainingAmount,
        advance: remainingAmount
      }
    });

  } catch (err) {
    await session.abortTransaction();
    console.error("paySupplierDueManually failed:", err);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    await session.endSession();
  }
};



module.exports = {
  createPurchase,
  getPurchases,
  getPurchaseById,
  updatePurchase,
  deletePurchase,
  paySupplierDue,
  getPurchaseReport,
  paySupplierDueManually,
  getPurchasesBySupplierId
};
