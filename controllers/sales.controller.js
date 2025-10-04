const { ObjectId } = require("mongodb");
const { subtractFromInventory, increaseCash } = require("../utils/cashAndInventory.js");
const { createCustomerIfNotExists, updateCustomerBalance } = require("../utils/customerService.js");
const {db} = require("../db.js");

async function createSell(req, res) {
  const { products, totalAmount, customerName, customer_type } = req.body;

  if (!products || products.length === 0) {
    return res.status(400).json({ success: false, error: "No products provided" });
  }
  if (!customerName) {
    return res.status(400).json({ success: false, error: "Customer name required" });
  }

  const memoId = new ObjectId();
  const sellDate = new Date();

  try {
    // 1️⃣ Create customer inline if not exists
    const customer = await createCustomerIfNotExists({ name: customerName, customer_type });

    // 2️⃣ Subtract sold quantity from inventory
    for (const item of products) {
      await subtractFromInventory(item.productId, item.qty, "Sale", memoId.toString());
    }

    // 3️⃣ Increase cash (full payment only)
    await increaseCash(totalAmount, "Sale", memoId.toString());

    // 4️⃣ Record sell memo
    await db.collection("sells").insertOne({
      _id: memoId,
      customerId: customer._id,
      products,
      totalAmount,
      date: sellDate
    });

    // 5️⃣ Record ledger entry
    await db.collection("ledger").insertOne({
      memoId: memoId.toString(),
      type: "sale",
      totalAmount,
      date: sellDate
    });

    res.status(201).json({ success: true, message: "Sell memo created", memoId, customerId: customer._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { createSell };
