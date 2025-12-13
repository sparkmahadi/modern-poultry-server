const { ObjectId } = require("mongodb");
const { client, db } = require("../db.js");

const purchasesCol = db.collection("purchases");
const transactionsCol = db.collection("transactions");
const inventoryCol = db.collection("inventory");
const cashCol = db.collection("cash");
const suppliersCol = db.collection("suppliers");

// -------------------- CREATE PURCHASE --------------------
// async function createPurchase(req, res) {
//   const { products, total_amount, paymentType = "cash", advance = 0, supplier_id } = req.body;

//   if (!products || !products.length) {
//     return res.status(400).json({
//       success: false,
//       error: "Products array is required and cannot be empty",
//     });
//   }

//   // Validate each product before doing anything else
//   for (const p of products) {
//     const pid = extractProductId(p.product_id);
//     if (!pid) {
//       return res.status(400).json({
//         success: false,
//         error: `Invalid product_id for product: ${p.name}`,
//       });
//     }
//   }

//   const invoiceId = new ObjectId();
//   const purchaseDate = new Date();

//   const rollbackOps = [];
//   try {

//     // ----- STEP 1: Insert Purchase Record -----
//     const paid_amount = advance;
//     const payment_due = total_amount - paid_amount;

//     const purchaseData = {
//       _id: invoiceId,
//       supplier_id: supplier_id ? new ObjectId(supplier_id) : null,
//       products,
//       totalAmount: total_amount,
//       paid_amount,
//       payment_due,
//       paymentType,
//       date: purchaseDate,
//     };

//     await purchasesCol.insertOne(purchaseData);
//     rollbackOps.push(() => purchasesCol.deleteOne({ _id: invoiceId }));

//     // ----- STEP 2: Cash Handling -----
//     let cashAccount = await cashCol.findOne({});
//     const lastBalance = cashAccount?.balance || 0;

//     let newBalance = lastBalance;

//     if (paymentType === "cash") {
//       newBalance = lastBalance - paid_amount;

//       const transactionData = {
//         date: purchaseDate,
//         time: purchaseDate.toTimeString().split(" ")[0],
//         entry_source: "invoice",
//         invoice_id: invoiceId.toString(),
//         transaction_type: "debit",
//         particulars: `Purchase - ${products.map(p => `${p.name} x ${p.qty}`).join(", ")}`,
//         products,
//         amount: paid_amount,
//         balance_after_transaction: newBalance,
//         payment_details: { paid_amount, supplierDue: payment_due, paymentType },
//         created_by: "admin",
//       };

//       await transactionsCol.insertOne(transactionData);
//       rollbackOps.push(() => transactionsCol.deleteOne({ invoice_id: invoiceId.toString() }));

//       await cashCol.updateOne({}, { $set: { balance: newBalance } }, { upsert: true });
//       rollbackOps.push(() => cashCol.updateOne({}, { $set: { balance: lastBalance } }));
//     }

//     // ----- STEP 3: Inventory Update -----
//     for (const product of products) {
//       const result = await addToInventory(product, invoiceId);

//       if (!result.success) {
//         console.error("Inventory error:", result.message);
//         throw new Error(result.message);
//       }
//     }

//     // ----- STEP 4: Supplier Update -----
//     if (supplier_id) {
//       const supplierObjectId = new ObjectId(supplier_id);

//       await suppliersCol.updateOne(
//         { _id: supplierObjectId },
//         {
//           $set: { last_purchase_date: purchaseDate },
//           $inc: { total_purchase: total_amount, total_due: payment_due },
//         }
//       );

//       const purchasedProductNames = products.map(p => p.name);

//       await suppliersCol.updateOne(
//         { _id: supplierObjectId },
//         { $addToSet: { supplied_products: { $each: purchasedProductNames } } }
//       );

//       await suppliersCol.updateOne(
//         { _id: supplierObjectId },
//         {
//           $push: {
//             supplier_history: {
//               date: purchaseDate,
//               type: "purchase",
//               purchase_id: invoiceId,
//               products,
//               total_amount,
//               paid_amount: paid_amount,
//               due_after_payment: payment_due,
//               remarks: "New purchase created",
//             },
//           },
//         }
//       );
//     }

//     return res.status(201).json({
//       success: true,
//       message: "Purchase processed successfully",
//       invoiceId,
//       newCashBalance: newBalance,
//     });

//   } catch (err) {
//     console.error("Transaction failed:", err.message);

//     for (const undo of rollbackOps.reverse()) {
//       try {
//         await undo();
//       } catch (rollbackError) {
//         console.error("Rollback failed:", rollbackError);
//       }
//     }

//     return res.status(500).json({
//       success: false,
//       error: err.message,
//     });
//   }
// }


async function createPurchase(req, res) {
  // Start a MongoDB session (required for transactions)
  const session = client.startSession();

  // Debug: log incoming request payload
  console.log(req.body);

  try {
    // Destructure required fields from request body
    const {
      products,                 // Array of purchased products
      total_amount,             // Total purchase amount
      payment_method = "cash",  // Payment method (cash / bank / bkash)
      paid_amount,              // Amount paid now
      supplier_id,              // Supplier ID (optional)
    } = req.body;

    // Basic validation: products array must exist and not be empty
    if (!products || !products.length) {
      return res.status(400).json({
        success: false,
        error: "Products array is required and cannot be empty",
      });
    }

    // Validate each product's product_id before starting transaction
    // This prevents wasting DB operations if data is invalid
    for (const p of products) {
      const pid = extractProductId(p.product_id);
      if (!pid) {
        return res.status(400).json({
          success: false,
          error: `Invalid product_id for product: ${p.name}`,
        });
      }
    }

    // Generate unique invoice ID for this purchase
    const invoice_id = new ObjectId();

    // Capture purchase date once to maintain consistency across collections
    const purchaseDate = new Date();

    // Calculate remaining due after payment
    const payment_due = total_amount - paid_amount;

    // Start MongoDB transaction
    await session.startTransaction();

    /* -------------------------------------------------
       STEP 1: Insert Purchase Record
       Stores the main purchase invoice
    -------------------------------------------------- */
    await purchasesCol.insertOne(
      {
        _id: invoice_id,                                // Invoice ID
        supplier_id: supplier_id ? new ObjectId(supplier_id) : null,
        products,                                      // Purchased product list
        total_amount,                                  // Total purchase value
        paid_amount,                                   // Paid amount
        payment_due,                                   // Due after payment
        payment_method,                                // Payment method
        date: purchaseDate,                            // Purchase date
      },
      { session } // Attach transaction session
    );

    /* -------------------------------------------------
       STEP 2: Cash / Payment Handling
       Only applies when payment method is cash
    -------------------------------------------------- */
    let newBalance = 0;

    if (payment_method === "cash") {
      // Fetch current cash account balance
      const cashAccount = await cashCol.findOne({}, { session });

      // Default balance to 0 if account doesn't exist
      const lastBalance = cashAccount?.balance || 0;

      // Deduct paid amount from cash balance
      newBalance = lastBalance - paid_amount;

      // Update cash account balance
      await cashCol.updateOne(
        {},
        { $set: { balance: newBalance } },
        { upsert: true, session }
      );
    }

    /* -------------------------------------------------
       STEP 3: Inventory Update
       Increases stock for each purchased product
    -------------------------------------------------- */
    for (const product of products) {
      // addToInventory must also receive session
      const result = await addToInventory(product, invoice_id, session);

      // If inventory update fails, abort transaction
      if (!result.success) {
        throw new Error(result.message);
      }
    }

    // Commit transaction — all changes are now permanent
    await session.commitTransaction();

    // Respond with success
    return res.status(201).json({
      success: true,
      message: "Purchase processed successfully",
      invoiceId: invoice_id,
      newCashBalance: newBalance,
    });

  } catch (err) {
    // Abort transaction on any error
    await session.abortTransaction();

    console.error("Transaction aborted:", err.message);

    return res.status(500).json({
      success: false,
      error: err.message,
    });

  } finally {
    // End MongoDB session (must be done in all cases)
    await session.endSession();
  }
}



// -------------------- GET PURCHASES --------------------
async function getPurchases(req, res) {
  const query = req.query.type;
  try {
    const filter = query ? { payment_due: { $gt: 0 } } : {};
    const purchases = await purchasesCol.find(filter).sort({ date: -1 }).toArray();
    res.status(200).json({ success: true, data: purchases });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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

// -------------------- UPDATE PURCHASE --------------------
async function updatePurchase(req, res) {
  try {
    const purchaseId = new ObjectId(req.params.id);
    const { products, totalAmount, paid_amount, paymentType, supplier_id } = req.body;
    const payment_due = totalAmount - paid_amount;

    const existingPurchase = await purchasesCol.findOne({ _id: purchaseId });
    if (!existingPurchase) return res.status(404).json({ success: false, message: "Purchase not found" });

    // Revert old inventory
    for (const item of existingPurchase.products || []) {
      const result = await deductFromInventory(item, purchaseId);
      if (!result.success) return res.status(400).json({ success: false, message: `Revert failed: ${result.message}` });
    }

    // Revert old cash if cash payment
    const oldPaid = existingPurchase.paid_amount || 0;
    const oldPaymentType = existingPurchase.paymentType;
    if (oldPaid && oldPaymentType === "cash") {
      const result = await decreaseCash(oldPaid, "invoice", {
        invoiceId: purchaseId,
        products: existingPurchase.products,
        paymentDetails: { paid_amount: oldPaid, supplierDue: existingPurchase.totalAmount - oldPaid, paymentType: oldPaymentType },
      });
      if (!result.success) return res.status(400).json({ success: false, message: `Failed to revert old cash: ${result.message}` });
    }

    // Revert old supplier totals
    if (existingPurchase.supplier_id) {
      const supplierObjId = new ObjectId(existingPurchase.supplier_id);
      const totalOldPurchase = existingPurchase.totalAmount || 0;
      const totalOldDue = (existingPurchase.totalAmount || 0) - (existingPurchase.paid_amount || 0);

      await suppliersCol.updateOne(
        { _id: supplierObjId },
        { $inc: { total_purchase: -totalOldPurchase, total_due: -totalOldDue }, $set: { last_purchase_date: new Date() } }
      );
    }

    // Add new inventory
    for (const item of products || []) {
      const result = await addToInventory(item, purchaseId);
      if (!result.success) return res.status(400).json({ success: false, message: `Add failed: ${result.message}` });
    }

    // Record new cash if cash payment
    if (paid_amount && paymentType === "cash") {
      const result = await decreaseCash(paid_amount, "invoice", {
        invoiceId: purchaseId,
        products,
        paymentDetails: { paid_amount, supplierDue: totalAmount - paid_amount, paymentType },
      });
      if (!result.success) return res.status(400).json({ success: false, message: `Failed to record cash: ${result.message}` });
    }

    // Update supplier totals
    if (supplier_id) {
      const supplierObjId = new ObjectId(supplier_id);
      const supplierDue = totalAmount - paid_amount;

      await suppliersCol.updateOne(
        { _id: supplierObjId },
        { $inc: { total_purchase: totalAmount, total_due: supplierDue }, $set: { last_purchase_date: new Date() } }
      );

      // Add supplier history for updated purchase
      await suppliersCol.updateOne(
        { _id: supplierObjId },
        {
          $push: {
            supplier_history: {
              date: new Date(),
              type: "updated_purchase",
              purchase_id: purchaseId,
              products,
              total_amount: totalAmount,
              paid_amount: paid_amount,
              due_after_payment: payment_due,
              remarks: "Purchase updated"
            }
          }
        }
      );
    }

    // Update purchase record
    await purchasesCol.updateOne(
      { _id: purchaseId },
      { $set: { products, totalAmount, paid_amount, paymentType, payment_due, supplier_id: supplier_id ? new ObjectId(supplier_id) : null, date: new Date() } }
    );

    const updatedPurchase = await purchasesCol.findOne({ _id: purchaseId });

    res.status(200).json({ success: true, message: "Purchase updated successfully", data: updatedPurchase });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// -------------------- PAY SUPPLIER DUE --------------------
async function paySupplierDue(req, res) {
  try {
    const purchaseId = new ObjectId(req.params.id);
    const { payAmount, paymentMethod="cash" } = req.body;

    if (!payAmount || payAmount <= 0) return res.status(400).json({ success: false, message: "Invalid payment amount." });

    const purchase = await purchasesCol.findOne({ _id: purchaseId });
    if (!purchase) return res.status(404).json({ success: false, message: "Purchase not found" });

    const oldPaid = purchase.paid_amount || 0;
    const oldTotal = purchase.totalAmount || 0;
    const oldDue = oldTotal - oldPaid;
    if (payAmount > oldDue) return res.status(400).json({ success: false, message: "Payment exceeds due amount" });

    // Update cash ledger if cash payment
    if (paymentMethod === "cash") {
      const result = await decreaseCash(payAmount, "supplier_due_payment", {
        purchaseId,
        previousPaid: oldPaid,
        payAmount,
      });
      if (!result.success) return res.status(400).json({ success: false, message: "Failed to record cash transaction" });
    }

    // Update supplier totals
    if (purchase.supplier_id) {
      const supplierObjId = new ObjectId(purchase.supplier_id);
      await suppliersCol.updateOne(
        { _id: supplierObjId },
        {
          $inc: { total_due: -payAmount },
          $set: { last_payment_date: new Date() }
        }
      );

      // Add supplier transaction history
      await suppliersCol.updateOne(
        { _id: supplierObjId },
        {
          $push: {
            supplier_history: {
              date: new Date(),
              type: "due_payment",
              purchase_id: purchaseId,
              paid_amount: payAmount,
              previous_due: oldDue,
              due_after_payment: oldDue - payAmount,
              payment_method: paymentMethod,
              remarks: "Due partially or fully paid"
            }
          }
        }
      );
    }

    // Update purchase payment fields
    const updatedPaid = oldPaid + payAmount;
    const newDue = oldTotal - updatedPaid;
    await purchasesCol.updateOne(
      { _id: purchaseId },
      { $set: { paid_amount: updatedPaid, payment_due: newDue, paymentType: paymentMethod, last_payment_date: new Date() } }
    );

    const updatedPurchase = await purchasesCol.findOne({ _id: purchaseId });

    res.status(200).json({ success: true, message: "Supplier due paid successfully", data: updatedPurchase });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// -------------------- DELETE PURCHASE --------------------
async function deletePurchase(req, res) {
  try {
    const purchaseId = new ObjectId(req.params.id);
    const existingPurchase = await purchasesCol.findOne({ _id: purchaseId });
    if (!existingPurchase) return res.status(404).json({ success: false, message: "Purchase not found" });

    await purchasesCol.deleteOne({ _id: purchaseId });
    res.status(200).json({ success: true, message: "Purchase deleted successfully" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// -------------------- INVENTORY HELPERS --------------------
// async function addToInventory(product, invoiceId) {
//   try {
//     const pid = extractProductId(product.product_id);

//     if (!pid) {
//       return {
//         success: false,
//         message: `Invalid product_id for: ${product?.name}`,
//       };
//     }

//     const productObjectId = new ObjectId(pid);

//     if (!product.qty || !product.purchase_price) {
//       return {
//         success: false,
//         message: `Invalid qty or purchase_price for product: ${product.name}`,
//       };
//     }

//     const purchaseRecord = {
//       invoice_id: invoiceId.toString(),
//       qty: product.qty,
//       purchase_price: product.purchase_price,
//       subtotal: product.subtotal,
//       date: new Date(),
//     };

//     const existingItem = await inventoryCollection.findOne({
//       product_id: productObjectId,
//     });

//     if (existingItem) {
//       const oldQty = existingItem.total_stock_qty || 0;
//       const oldAvg = existingItem.average_purchase_price || product.purchase_price;

//       const newAvg =
//         (oldAvg * oldQty + product.purchase_price * product.qty) /
//         (oldQty + product.qty);

//       await inventoryCollection.updateOne(
//         { product_id: productObjectId },
//         {
//           $inc: { total_stock_qty: product.qty },
//           $set: {
//             last_purchase_price: product.purchase_price,
//             average_purchase_price: newAvg,
//             last_updated: new Date(),
//           },
//           $push: { purchase_history: purchaseRecord },
//         }
//       );

//       return { success: true, message: `Inventory updated for ${product.name}` };
//     } else {
//       await inventoryCollection.insertOne({
//         product_id: productObjectId,
//         item_name: product.name,
//         total_stock_qty: product.qty,
//         sale_price: null,
//         last_purchase_price: product.purchase_price,
//         average_purchase_price: product.purchase_price,
//         reorder_level: 0,
//         last_updated: new Date(),
//         purchase_history: [purchaseRecord],
//         sale_history: [],
//       });

//       return { success: true, message: `New inventory item added: ${product.name}` };
//     }
//   } catch (error) {
//     return {
//       success: false,
//       message: `Failed to update inventory for ${product?.name}: ${error.message}`,
//     };
//   }
// }


async function addToInventory(product, invoice_id, session) {
  try {
    await inventoryCol.updateOne(
      { product_id: extractProductId(product.product_id) },
      {
        $inc: { stock: product.qty },
        $push: {
          history: {
            invoice_id,
            qty: product.qty,
            type: "purchase",
            date: new Date(),
          },
        },
      },
      { upsert: true, session }
    );

    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}


function extractProductId(rawId) {
  if (!rawId) return null;

  // CASE 1: Extended JSON { "$oid": "id" }
  if (typeof rawId === "object" && rawId.$oid) {
    return rawId.$oid;
  }

  // CASE 2: Plain string
  if (typeof rawId === "string") {
    return rawId;
  }

  // CASE 3: ObjectId instance
  if (rawId instanceof ObjectId) {
    return rawId.toString();
  }

  return null;
}


async function deductFromInventory(product, memoId) {
  try {
    const productId = product.product_id || product._id;
    if (!productId || !product.qty) return { success: false, message: `Invalid product data (${product?.name || "Unknown"})` };

    const existingItem = await inventoryCol.findOne({ product_id: new ObjectId(productId) });
    if (!existingItem) return { success: false, message: `Product not found: ${product.name}` };

    const saleRecord = {
      memo_id: memoId.toString(),
      qty: product.qty,
      price: product.price || product.purchase_price || 0,
      subtotal: product.subtotal || 0,
      date: new Date()
    };

    const result = await inventoryCol.updateOne(
      { product_id: new ObjectId(productId) },
      { $inc: { total_stock_qty: -product.qty }, $set: { last_updated: new Date() }, $push: { sale_history: saleRecord } }
    );

    if (result.modifiedCount > 0) return { success: true, message: `Inventory updated for ${product.name}` };
    return { success: false, message: `No update occurred for ${product.name}` };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// -------------------- CASH HELPERS --------------------
async function increaseCash(amount, entrySource, details = {}) {
  try {
    const cashAccount = await cashCol.findOne({});
    const lastBalance = cashAccount?.current_balance || 0;
    const newBalance = lastBalance + amount;

    await transactionsCol.insertOne({
      date: new Date(),
      time: new Date().toTimeString().split(" ")[0],
      entry_source: entrySource,
      transaction_type: "credit",
      amount,
      balance_after_transaction: newBalance,
      payment_details: details.paymentDetails || {},
      products: details.products || [],
      invoice_id: details.invoiceId || details.memoId || null,
      created_by: details.createdBy || "admin",
      remarks: details.remarks || ""
    });

    await cashCol.updateOne({}, { $set: { current_balance: newBalance } }, { upsert: true });
    return { success: true, newBalance, message: "Cash increased successfully" };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function decreaseCash(amount, entrySource, details = {}) {
  try {
    const cashAccount = await cashCol.findOne({});
    const lastBalance = cashAccount?.current_balance || 0;
    const newBalance = lastBalance - amount;

    await transactionsCol.insertOne({
      date: new Date(),
      time: new Date().toTimeString().split(" ")[0],
      entry_source: entrySource,
      transaction_type: "debit",
      amount,
      balance_after_transaction: newBalance,
      payment_details: details.paymentDetails || {},
      products: details.products || [],
      invoice_id: details.invoiceId || details.memoId || null,
      created_by: details.createdBy || "admin",
      remarks: details.remarks || ""
    });

    await cashCol.updateOne({}, { $set: { current_balance: newBalance } }, { upsert: true });
    return { success: true, newBalance, message: "Cash decreased successfully" };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

module.exports = {
  createPurchase,
  getPurchases,
  getPurchaseById,
  updatePurchase,
  deletePurchase,
  paySupplierDue,
};
