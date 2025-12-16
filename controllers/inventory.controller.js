const { ObjectId } = require("mongodb");
const {db} = require("../db");
const inventoryCol = db.collection("inventory");

// 📦 Get all inventory or specific product(s)
module.exports.getInventory = async (req, res) => {
  console.log("Hit inventory api")
  try {
    const { id, search } = req.query;

    let query = {};

    // 🧭 If ID provided → get single product
    if (id) {
      query._id = new ObjectId(id);
    }

    // 🔍 If search term provided → match product name (case-insensitive)
    if (search) {
      query.item_name = { $regex: new RegExp(search, "i") };
    }

    // 🚀 Fetch data
    const inventoryData = await inventoryCol.find(query).toArray();

    if (!inventoryData || inventoryData.length === 0) {
      return res.json({ success: false, message: "No inventory data found" });
    }

    // ✅ Success response
    res.status(200).json({
      success: true,
      count: inventoryData.length,
      data: inventoryData,
    });

  } catch (err) {
    console.error("❌ Error fetching inventory:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * 🧾 PUT: Update product info or stock quantity
 */
exports.updateInventory = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (!id) return res.status(400).json({ success: false, error: "Product ID required" });

    // Add timestamp for tracking
    updates.last_updated = new Date();

    const result = await inventoryCol.updateOne(
      { _id: new ObjectId(id) },
      { $set: updates }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    res.status(200).json({ success: true, message: "Inventory updated successfully" });
  } catch (err) {
    console.error("❌ Error updating inventory:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * 🗑️ DELETE: Remove a product from inventory
 */
exports.deleteInventoryItem = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) return res.status(400).json({ success: false, error: "Product ID required" });

    const result = await inventoryCol.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    res.status(200).json({ success: true, message: "Product deleted successfully" });
  } catch (err) {
    console.error("❌ Error deleting inventory item:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// 📦 Get total stock level (sum of all entries for same product_id)
exports.getStockByProductId = async (req, res) => {
  try {
    const { productId } = req.params;
    console.log("getStockByProductId", productId);
    
    if (!productId) {
      return res.status(400).json({
        success: false,
        message: "Product ID is required",
      });
    }
    
    // Aggregate all inventory docs with same product_id and sum the total_stock_qty
    const result = await inventoryCol.findOne({product_id: new ObjectId(productId)});
    
    // If product not found in inventory
    if (!result) {
      return res.json({
        success: false,
        message: "Product not found in inventory",
        stock: 0,
      });
    }
    
    // Respond with summed total stock
    const totalStock = result.stock_qty;
    console.log('checking stock qty', totalStock);
    res.status(200).json({
      success: true,
      productId,
      stock: totalStock,
    });
  } catch (error) {
    console.error("❌ Error checking stock:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch product stock",
      error: error.message,
    });
  }
};

