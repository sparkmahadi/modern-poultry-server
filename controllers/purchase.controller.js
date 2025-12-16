const { ObjectId } = require("mongodb");
const { client, db } = require("../db.js");
const { updateAccountBalance } = require("../services/accountBalance.service.js");
const { increaseInventoryStock, decreaseInventoryStock, addToInventory } = require("../services/inventory.service.js");
const { extractProductId } = require("../utils/id.util.js");

const purchasesCol = db.collection("purchases");
const inventoryCol = db.collection("inventory");
const suppliersCol = db.collection("suppliers");


// -------------------- GET PURCHASES --------------------
async function getPurchases(req, res) {
  console.log('hit getPurchases');
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


async function createPurchase(req, res) {
  const session = client.startSession();

  try {
    const { products, total_amount, paid_amount = 0, payment_method = "cash", account_id, supplier_id } = req.body;
    if (!products || !products.length) return res.status(400).json({ success: false, message: "Products array cannot be empty" });
    if (paid_amount > 0 && !account_id) return res.status(400).json({ success: false, message: "Account selection is required for payment" });

    const invoice_id = new ObjectId();
    const purchaseDate = new Date();
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
async function updatePurchase(req, res) {
  const session = client.startSession();

  try {
    const purchaseId = new ObjectId(req.params.id);
    const payload = req.body;

    console.log("➡️ Update purchase called:", purchaseId.toString());
    console.log("📦 Incoming payload products:", payload.products);

    await session.startTransaction();
    console.log("✅ Transaction started");

    /* --------------------------------------------------
       1️⃣ FETCH EXISTING PURCHASE
    -------------------------------------------------- */
    const existingPurchase = await purchasesCol.findOne(
      { _id: purchaseId },
      { session }
    );

    console.log("📄 Existing purchase:", existingPurchase);

    if (!existingPurchase) {
      console.log("❌ Purchase not found");
      return res.status(404).json({ success: false, message: "Purchase not found" });
    }

    /* --------------------------------------------------
   2️⃣ INVENTORY ADJUSTMENT (USING SERVICES)
-------------------------------------------------- */

const oldMap = new Map();
existingPurchase.products.forEach(p => {
  oldMap.set(p.product_id.toString(), p);
});

const newMap = new Map();
payload.products.forEach(p => {
  newMap.set(p.product_id.toString(), p);
});

/* -------------------------------
   Added or updated products
-------------------------------- */
for (const [productId, newProd] of newMap) {
  const oldProd = oldMap.get(productId);

  if (!oldProd) {
    // ➕ Newly added product
    const inc = await increaseInventoryStock({
      product_id: productId,
      qty: newProd.qty
    });

    if (!inc.success) throw new Error(inc.message);

  } else {
    const diff = newProd.qty - oldProd.qty;

    if (diff > 0) {
      const inc = await increaseInventoryStock({
        product_id: productId,
        qty: diff
      });
      if (!inc.success) throw new Error(inc.message);

    } else if (diff < 0) {
      const dec = await decreaseInventoryStock({
        product_id: productId,
        qty: Math.abs(diff)
      });
      if (!dec.success) throw new Error(dec.message);
    }
  }
}

/* -------------------------------
   Removed products
-------------------------------- */
for (const [productId, oldProd] of oldMap) {
  if (!newMap.has(productId)) {
    const dec = await decreaseInventoryStock({
      product_id: productId,
      qty: oldProd.qty
    });
    if (!dec.success) throw new Error(dec.message);
  }
}



    /* --------------------------------------------------
       3️⃣ ACCOUNT BALANCE ADJUSTMENT
    -------------------------------------------------- */
    const oldPaid = existingPurchase.paid_amount || 0;
    const newPaid = payload.paid_amount || 0;

    console.log("💰 Old paid:", oldPaid);
    console.log("💰 New paid:", newPaid);

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

      await updateAccountBalance({
        client,
        db,
        amount: newPaid,
        transactionType: "debit",
        entrySource: "purchase_update",
        accountId: payload.account_id,
        details: payload
      });
    }

    /* --------------------------------------------------
       4️⃣ SUPPLIER DUE ADJUSTMENT
    -------------------------------------------------- */
    const suppliersCol = db.collection("suppliers");

    const oldTotal = existingPurchase.total_amount;
    const newTotal = payload.total_amount;

    const oldDue = oldTotal - oldPaid;
    const newDue = newTotal - newPaid;

    const dueDiff = newDue - oldDue;
    const purchaseDiff = newTotal - oldTotal;

    console.log("🏭 Supplier due diff:", dueDiff);
    console.log("🏭 Supplier purchase diff:", purchaseDiff);

    await suppliersCol.updateOne(
      { _id: new ObjectId(payload.supplier_id) },
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

    /* --------------------------------------------------
       5️⃣ UPDATE SUPPLIER HISTORY ENTRY
    -------------------------------------------------- */
    console.log("📝 Updating supplier history");

    await suppliersCol.updateOne(
      {
        _id: new ObjectId(payload.supplier_id),
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

    /* --------------------------------------------------
       6️⃣ UPDATE PURCHASE DOCUMENT
    -------------------------------------------------- */
    console.log("📄 Updating purchase document");

    await purchasesCol.updateOne(
      { _id: purchaseId },
      {
        $set: {
          products: payload.products,
          total_amount: newTotal,
          paid_amount: newPaid,
          payment_due: newDue,
          payment_method: payload.payment_method,
          account_id: payload.account_id ? new ObjectId(payload.account_id) : null,
          last_payment_date: new Date(),
          updated_at: new Date()
        }
      },
      { session }
    );

    await session.commitTransaction();
    console.log("✅ Transaction committed");

    res.status(200).json({
      success: true,
      message: "Purchase updated successfully"
    });

  } catch (error) {
    await session.abortTransaction();
    console.error("❌ Purchase update failed:", error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
    console.log("🧹 Session ended");
  }
}




/* ======================
   CONTROLLER: paySupplierDue (unified accounts)
   ====================== */
async function paySupplierDue(req, res) {
  const purchaseId = new ObjectId(req.params.id);
  const { payAmount, paymentAccountId } = req.body;

  if (!payAmount || payAmount <= 0) return res.status(400).json({ success: false, message: "Invalid payment amount" });
  if (!paymentAccountId) return res.status(400).json({ success: false, message: "Payment account is required" });

  try {
    const purchase = await purchasesCol.findOne({ _id: purchaseId });
    if (!purchase) return res.status(404).json({ success: false, message: "Purchase not found" });

    const oldPaid = Number(purchase.paid_amount || 0);
    const total = Number(purchase.total_amount || 0);
    const due = total - oldPaid;

    if (payAmount > due) return res.status(400).json({ success: false, message: "Payment exceeds due amount" });

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
    if (!paymentResult.success) return res.status(400).json(paymentResult);

    // Update purchase payment
    const updatedPaid = oldPaid + payAmount;
    const newDue = total - updatedPaid;

    await purchasesCol.updateOne(
      { _id: purchaseId },
      { $set: { paid_amount: updatedPaid, payment_due: newDue, paymentAccountId, last_payment_date: new Date() } }
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


// -------------------- DELETE PURCHASE --------------------
async function deletePurchase(req, res) {
  const session = client.startSession();

  try {
    const purchaseId = new ObjectId(req.params.id);
    const existingPurchase = await purchasesCol.findOne({ _id: purchaseId });
    if (!existingPurchase) return res.status(404).json({ success: false, message: "Purchase not found" });

    await session.startTransaction();

    // 1️⃣ Revert inventory
    for (const item of existingPurchase.products || []) {
      const result = await deductFromInventory(item, purchaseId, session);
      if (!result.success) throw new Error(`Revert inventory failed: ${result.message}`);
    }

    // 2️⃣ Revert payment if any
    if (existingPurchase.paid_amount > 0 && existingPurchase.account_id) {
      const revertResult = await updateAccountBalance({
        client,
        db,
        amount: existingPurchase.paid_amount,
        transactionType: "credit",
        entrySource: "purchase_delete",
        accountId: existingPurchase.account_id,
        details: { invoiceId: purchaseId, remarks: "Revert payment on delete" }
      });
      if (!revertResult.success) throw new Error(`Revert payment failed: ${revertResult.message}`);
    }

    // 3️⃣ Update supplier balances
    if (existingPurchase.supplier_id) {
      const supplierObjId = new ObjectId(existingPurchase.supplier_id);
      const balanceDiff = existingPurchase.total_amount - existingPurchase.paid_amount;
      const advanceDiff = existingPurchase.paid_amount > existingPurchase.total_amount ? existingPurchase.paid_amount - existingPurchase.total_amount : 0;
      const dueDiff = balanceDiff > 0 ? balanceDiff : 0;

      await suppliersCol.updateOne(
        { _id: supplierObjId },
        {
          $inc: { total_purchase: -existingPurchase.total_amount, total_due: -dueDiff, due: -dueDiff, advance: -advanceDiff },
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
    }

    // 4️⃣ Delete purchase
    await purchasesCol.deleteOne({ _id: purchaseId }, { session });

    await session.commitTransaction();
    return res.status(200).json({ success: true, message: "Purchase deleted successfully" });

  } catch (err) {
    await session.abortTransaction();
    console.error("Delete purchase failed:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    await session.endSession();
  }
}


// /* ======================
//    INVENTORY HELPERS
//    ====================== */
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

//     const existingItem = await inventoryCol.findOne({
//       product_id: productObjectId,
//     });

//     if (existingItem) {
//       const oldQty = existingItem.stock_qty || 0;
//       const oldAvg = existingItem.average_purchase_price ?? product.purchase_price;

//       const newAvg =
//         (oldAvg * oldQty + product.purchase_price * product.qty) /
//         (oldQty + product.qty);

//       await inventoryCol.updateOne(
//         { product_id: productObjectId },
//         {
//           $inc: { stock_qty: product.qty },
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
//       await inventoryCol.insertOne({
//         product_id: productObjectId,
//         item_name: product.name,
//         stock_qty: product.qty,
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


module.exports = {
  createPurchase,
  getPurchases,
  getPurchaseById,
  updatePurchase,
  deletePurchase,
  paySupplierDue,
};
