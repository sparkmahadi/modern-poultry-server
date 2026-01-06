const express = require("express");
const { getInventory, updateInventory, deleteInventoryItem, getStockByProductId, getInventoryById } = require("../controllers/inventory.controller");

const router = express.Router();

// Basic sell memo
// GET /api/inventory
// GET /api/inventory?id=68e154c4a8b036cdc42a6de8
// GET /api/inventory?search=daal
router.get("/", getInventory);

router.get("/:id", getInventoryById);

// PUT /api/inventory/68e154c4a8b036cdc42a6de8
// {
//   "stock_qty": 75,
//   "sell_price": 7
// }

router.put("/:id", updateInventory);
router.delete("/:id", deleteInventoryItem);
// GET current stock for a specific product
router.get("/stock/:productId", getStockByProductId);


module.exports = router;
