const { ObjectId } = require("mongodb");
const { client, db } = require("../db");
const { updateAccountBalance } = require("../services/accountBalance.service");
const { extractProductId } = require("../utils/id.util");
const { addToInventory } = require("../services/inventory.service");

const salesCol = db.collection("sales");
const inventoryCol = db.collection("inventory");
const customersCol = db.collection("customers");

async function deductFromInventory(product, memoId, session) {
  try {
    const productId = extractProductId(product.product_id) || product._id;
    if (!productId || !product.qty) return { success: false, message: `Invalid product data (${product?.name || "Unknown"})` };

    const existingItem = await inventoryCol.findOne({ product_id: new ObjectId(productId) }, { session });
    if (!existingItem) return { success: false, message: `Product not added in inventory: ${productId}` };

    if (existingItem.stock_qty < product.qty) {
      return { success: false, message: `Insufficient stock quantity`, available: existingItem.stock_qty, requested: product.qty };
    }

    const saleRecord = {
      memo_id: memoId.toString(),
      qty: product.qty,
      price: product.sale_price || product.Sale_price || 0,
      subtotal: product.subtotal || 0,
      date: new Date()
    };

    const result = await inventoryCol.updateOne(
      { product_id: new ObjectId(productId) },
      {
        $inc: { stock_qty: -product.qty },
        $set: { last_updated: new Date() },
        $push: { sale_history: saleRecord }
      },
      { session }
    );

    if (result.modifiedCount > 0) return { success: true, message: `Inventory updated for ${product.name}` };
    return { success: false, message: `No update occurred for ${product.name}` };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

module.exports.createSell = async (req, res) => {
  const session = client.startSession();
  try {
    const { memoNo, date, customer_id, products, total_amount, paid_amount = 0, payment_method, account_id, batch_id } = req.body;
    console.log('create sell', req.body);
    if (!products || !products.length) return res.status(400).json({ success: false, message: "Products array cannot be empty" });
    if (!customer_id) return res.status(400).json({ success: false, message: "Customer is required" });
    if (paid_amount > 0 && !account_id) return res.status(400).json({ success: false, message: "Account selection is required for payment" });

    const memoId = new ObjectId();
    const sellDate = date ? new Date(date) : new Date();
    const due_amount = total_amount - paid_amount;
    const advance_amount = paid_amount > total_amount ? paid_amount - total_amount : 0;

    await session.startTransaction();

    // 1️⃣ Insert sale memo
    await salesCol.insertOne({
      _id: memoId,
      memoNo,
      date: sellDate,
      customer_id: new ObjectId(customer_id),
      products,
      total_amount,
      paid_amount,
      due_amount,
      payment_method,
      batch_id,
      account_id: paid_amount > 0 ? new ObjectId(account_id) : null,
      createdAt: new Date()
    }, { session });

    // 2️⃣ Credit account if paid
    if (paid_amount > 0) {
      const paymentResult = await updateAccountBalance({
        client,
        db,
        amount: paid_amount,
        transactionType: "credit",
        entrySource: "sale",
        accountId: account_id,
        details: { memoId },
        session
      });
      if (!paymentResult.success) throw new Error(paymentResult.message);
    }

    // 3️⃣ Deduct inventory stock
    for (const product of products) {
      const result = await deductFromInventory(product, memoId, session);
      if (!result.success) throw new Error(result.message);
    }

    // 4️⃣ Update customer ledger
    await customersCol.updateOne(
      { _id: new ObjectId(customer_id) },
      {
        $inc: { total_sales: total_amount, total_due: due_amount > 0 ? due_amount : 0, due: due_amount, advance: advance_amount },
        $set: { last_Sale_date: sellDate },
        $push: {
          customer_history: {
            date: sellDate,
            type: "sale",
            sale_id: memoId,
            products,
            total_amount,
            paid_amount,
            due_after_payment: due_amount,
            remarks: "New sale created"
          }
        }
      },
      { session }
    );

    // ✅ Commit transaction
    await session.commitTransaction();

    return res.status(201).json({ success: true, message: "Sale processed successfully", memoId });

  } catch (err) {
    await session.abortTransaction();
    console.error("SALE FAILED:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    await session.endSession();
  }
};


/* =====================================================
   GET ALL SALES
===================================================== */
module.exports.getSales = async (req, res) => {
  try {
    const sales = await salesCol.find({}).sort({ date: -1 }).toArray();
    res.status(200).json({ success: true, data: sales });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


/* =====================================================
   GET SALES BY CUSTOMER
===================================================== */
module.exports.getSalesByCustomerId = async (req, res) => {
  const { customerId } = req.params;

  try {
    const sales = await salesCol.find({
      customer_id: new ObjectId(customerId)
    }).toArray();

    res.status(200).json({ success: true, data: sales });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


/* =====================================================
   GET SINGLE SALE
===================================================== */
module.exports.getSaleById = async (req, res) => {
  try {
    const { id } = req.params;

    const sale = await salesCol.findOne({ _id: new ObjectId(id) });

    if (!sale) {
      return res.status(404).json({ success: false, message: "Sale not found" });
    }

    res.status(200).json({ success: true, sale });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


module.exports.updateSaleById = async (req, res) => {
  const session = client.startSession();

  try {
    const saleId = new ObjectId(req.params.id);
    
    const { memoNo, date, customer_id, products, total_amount, paid_amount = 0, payment_method, account_id } = req.body;
    const payload = req.body;

    console.log("➡️ Update sale called:", saleId.toString());
    console.log("📦 Incoming payload products:", products);

    await session.startTransaction();
    console.log("✅ Transaction started");

    /* --------------------------------------------------
       1️⃣ FETCH EXISTING SALE
    -------------------------------------------------- */
    const existingSale = await salesCol.findOne({ _id: saleId }, { session });

    if (!existingSale) {
      console.log("❌ Sale not found");
      return res.status(404).json({ success: false, message: "Sale not found" });
    }

    /* --------------------------------------------------
       2️⃣ INVENTORY ADJUSTMENT (if products changed)
    -------------------------------------------------- */
    if (products && products.length) {
      const oldMap = new Map();
      existingSale.products.forEach(p => oldMap.set(p.product_id.toString(), p));

      const newMap = new Map();
      products.forEach(p => newMap.set(p.product_id.toString(), p));

      // Added or updated products
      for (const [productId, newProd] of newMap) {
        const oldProd = oldMap.get(productId);

        if (!oldProd) {
          // ➕ Newly added product: deduct from inventory
          const dec = await decreaseInventoryStock({ product_id: productId, qty: newProd.qty });
          if (!dec.success) throw new Error(dec.message);

        } else {
          const diff = newProd.qty - oldProd.qty;

          if (diff > 0) {
            // Increase sale qty: deduct more from inventory
            const dec = await decreaseInventoryStock({ product_id: productId, qty: diff });
            if (!dec.success) throw new Error(dec.message);

          } else if (diff < 0) {
            // Decrease sale qty: return inventory
            const inc = await increaseInventoryStock({ product_id: productId, qty: Math.abs(diff) });
            if (!inc.success) throw new Error(inc.message);
          }
        }
      }

      // Removed products: return full qty to inventory
      for (const [productId, oldProd] of oldMap) {
        if (!newMap.has(productId)) {
          const inc = await increaseInventoryStock({ product_id: productId, qty: oldProd.qty });
          if (!inc.success) throw new Error(inc.message);
        }
      }
    }

    /* --------------------------------------------------
       3️⃣ ACCOUNT BALANCE ADJUSTMENT
    -------------------------------------------------- */
    const oldPaid = existingSale.paid_amount || 0;
    const newPaid = payload.paid_amount || 0;

    if (oldPaid > 0 && existingSale.account_id) {
      // Revert old payment
      await updateAccountBalance({
        client,
        db,
        amount: oldPaid,
        transactionType: "credit",
        entrySource: "sale_update",
        accountId: existingSale.account_id.toString(),
        details: existingSale,
        session
      });
    }

    if (newPaid > 0 && account_id) {
      // Apply new payment
      await updateAccountBalance({
        client,
        db,
        amount: newPaid,
        transactionType: "debit",
        entrySource: "sale_update",
        accountId: payload.account_id,
        details: payload,
        session
      });
    }

    /* --------------------------------------------------
       4️⃣ CUSTOMER DUE & HISTORY ADJUSTMENT
    -------------------------------------------------- */
    const oldTotal = existingSale.total_amount || 0;
    const newTotal = total_amount;

    const oldDue = oldTotal - oldPaid;
    const newDue = newTotal - newPaid;
    
    const newAdvance = newPaid > total_amount ? newPaid - total_amount : 0;
    const oldAdvance = oldPaid > oldTotal ? oldPaid - oldTotal : 0;

    if (existingSale.customer_id) {
      await customersCol.updateOne(
        { _id: new ObjectId(existingSale.customer_id) },
        {
          $inc: { due: newDue - oldDue, advance: newAdvance - oldAdvance },
          $set: { last_payment_date: new Date() },
          $push: {
            customer_history: {
              date: new Date(),
              type: "sale_update",
              sale_id: saleId,
              products: payload.products || existingSale.products,
              total_amount: newTotal,
              paid_amount: newPaid,
              due_after_payment: newDue,
              remarks: "Sale updated"
            }
          }
        },
        { session }
      );
    }

    /* --------------------------------------------------
       5️⃣ UPDATE SALE DOCUMENT
    -------------------------------------------------- */
    await salesCol.updateOne(
      { _id: saleId },
      {
        $set: {
          products: payload.products || existingSale.products,
          total_amount: newTotal,
          paid_amount: newPaid,
          due_amount: newDue,
          payment_method: payload.payment_method || existingSale.payment_method,
          account_id: payload.account_id ? new ObjectId(payload.account_id) : existingSale.account_id,
          updatedAt: new Date()
        }
      },
      { session }
    );

    await session.commitTransaction();
    console.log("✅ Transaction committed");

    const updatedSale = await salesCol.findOne({ _id: saleId });
    res.status(200).json({ success: true, message: "Sale updated successfully", data: updatedSale });

  } catch (error) {
    await session.abortTransaction();
    console.error("❌ Sale update failed:", error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    await session.endSession();
    console.log("🧹 Session ended");
  }
};


// -------------------- DELETE SALE --------------------
module.exports.deleteSale = async(req, res) => {
  const session = client.startSession();

  try {
    const saleId = new ObjectId(req.params.id);
    
    // Check if the sale exists before starting transaction
    const existingSale = await salesCol.findOne({ _id: saleId });
    if (!existingSale) {
      return res.status(404).json({ success: false, message: "Sale not found" });
    }

    await session.startTransaction();

    // 1️⃣ Revert Inventory: Add products back to stock
    // Assuming you have a function addToInventory that does the opposite of deductFromInventory
    for (const item of existingSale.products || []) {
      const result = await addToInventory(item, saleId);
      console.log(result);
      if (!result.success) throw new Error(`Revert inventory failed: ${result.message}`);
    }

    // 2️⃣ Revert Payment: If customer paid money, refund the account balance
    if (existingSale.paid_amount > 0 && existingSale.account_id) {
      const revertResult = await updateAccountBalance({
        client,
        db,
        amount: existingSale.paid_amount,
        transactionType: "debit", // Reversing a 'credit' (income) requires a 'debit' (expense/outflow)
        entrySource: "sale_delete",
        accountId: existingSale.account_id,
        details: { invoiceId: saleId, remarks: "Refund/Revert payment on sale deletion" }
      });
      if (!revertResult.success) throw new Error(`Revert payment failed: ${revertResult.message}`);
    }

    // 3️⃣ Update Customer Balances
    if (existingSale.customer_id) {
      const customerObjId = new ObjectId(existingSale.customer_id);
      
      // Calculate differences to revert
      const balanceDiff = existingSale.total_amount - existingSale.paid_amount;
      const dueDiff = balanceDiff > 0 ? balanceDiff : 0;
      const advanceDiff = existingSale.paid_amount > existingSale.total_amount ? existingSale.paid_amount - existingSale.total_amount : 0;

      await customersCol.updateOne(
        { _id: customerObjId },
        {
          $inc: { 
            total_sale: -existingSale.total_amount, 
            total_due: -dueDiff, 
            due: -dueDiff, 
            advance: -advanceDiff 
          },
          $push: {
            customer_history: {
              date: new Date(),
              type: "deleted_sale",
              sale_id: saleId,
              total_amount: existingSale.total_amount,
              paid_amount: existingSale.paid_amount,
              remarks: "Sale record deleted - Balances adjusted"
            }
          }
        },
        { session }
      );
    }

    // 4️⃣ Delete the Sale Record
    await salesCol.deleteOne({ _id: saleId }, { session });

    // Commit all changes
    await session.commitTransaction();
    return res.status(200).json({ success: true, message: "Sale deleted and balances reverted successfully" });

  } catch (err) {
    // If anything fails, abort transaction to maintain data integrity
    await session.abortTransaction();
    console.error("Delete sale failed:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    await session.endSession();
  }
}



module.exports.receiveCustomerDue = async (req, res) => {
  const session = client.startSession();

  try {
    const saleId = new ObjectId(req.params.saleId);
    const { payAmount, paymentAccountId } = req.body;
    console.log('receiveCustomerDue', saleId, req.body);
    if (!payAmount || payAmount <= 0)
      return res.status(400).json({ success: false, message: "Invalid payment amount" });

    if (!paymentAccountId)
      return res.status(400).json({ success: false, message: "Payment account is required" });

    await session.startTransaction();

    // 1️⃣ Find sale
    const sale = await salesCol.findOne({ _id: (saleId) });
    if (!sale) throw new Error("Sale not found");

    const oldPaid = Number(sale.paid_amount || 0);
    const total = Number(sale.total_amount || 0);
    const due = total - oldPaid;

    if (payAmount > due) throw new Error("Payment exceeds due amount");

    // 2️⃣ Credit account (customer pays)
    const paymentResult = await updateAccountBalance({
      client,
      db,
      amount: payAmount,
      transactionType: "credit",
      entrySource: "customer_due_payment",
      accountId: paymentAccountId,
      details: { saleId, remarks: `Customer due payment for sale ${saleId}` },
      session
    });
    if (!paymentResult.success) throw new Error(paymentResult.message);

    // 3️⃣ Update sale payment info
    const updatedPaid = oldPaid + payAmount;
    const newDue = total - updatedPaid;

    await salesCol.updateOne(
      { _id: saleId },
      {
        $set: {
          paid_amount: updatedPaid,
          due_amount: newDue,
          paymentAccountId,
          last_payment_date: new Date()
        },
        $push: {
          payment_history: {
            date: new Date(),
            amount: payAmount,
            account_id: paymentAccountId,
            due_after_payment: newDue,
            remarks: "Customer due payment"
          }
        }
      },
      { session }
    );

    // 4️⃣ Update customer ledger
    if (sale.customer_id) {
      await customersCol.updateOne(
        { _id: new ObjectId(sale.customer_id) },
        {
          $inc: { due: -payAmount },
          $set: { last_payment_date: new Date() },
          $push: {
            customer_history: {
              date: new Date(),
              type: "payment",
              sale_id: saleId,
              paid_amount: payAmount,
              due_after_payment: newDue,
              remarks: "Customer due payment received"
            }
          }
        },
        { session }
      );
    }

    // ✅ Commit transaction
    await session.commitTransaction();

    const updatedSale = await salesCol.findOne({ _id: saleId });
    return res.status(200).json({ success: true, message: "Customer due received successfully", data: updatedSale });

  } catch (err) {
    await session.abortTransaction();
    console.error("receiveCustomerDue failed:", err);
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    await session.endSession();
  }
}
