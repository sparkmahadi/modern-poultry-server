const express = require("express");
const { createBatch, updateBatch, getBatches, getBatchById, deleteBatch, addSellHistory, removeASellHistoryId, getBatchSales, getBatchByCustomerId } = require("../controllers/farmingbatch.controller");


const router = express.Router();

router.post("/", createBatch);
router.put("/:id", updateBatch);
router.post("/add-sell-history", addSellHistory);
router.post("/remove-a-sell-history", removeASellHistoryId);
router.get("/", getBatches);
router.get("/customer-farming-batches/:customerId", getBatchByCustomerId);
router.get("/:batchId/sales", getBatchSales);
router.get("/:id", getBatchById);
router.delete("/:id", deleteBatch);

module.exports = router;