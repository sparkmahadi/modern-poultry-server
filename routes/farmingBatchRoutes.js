const express = require("express");
const {
  createBatch,
  updateBatch,
  getBatches,
  getBatchById,
  deleteBatch,
  addSellHistory,
  removeASellHistoryId,
  getBatchSales,
  getBatchByCustomerId,
  buyBirdsFromFarmer,
  getBatchHarvestSummary
} = require("../controllers/farmingbatch.controller");

const router = express.Router();

// --- Core Batch Operations ---
router.post("/", createBatch);
router.get("/", getBatches);
router.get("/customer-farming-batches/:customerId", getBatchByCustomerId);

// --- Sell History Helpers ---
router.post("/add-sell-history", addSellHistory);
router.post("/remove-a-sell-history", removeASellHistoryId);

// --- Two-Stage Harvest & Bird Distribution ---
router.post("/:batchId/buy-birds", buyBirdsFromFarmer);
router.get("/:batchId/harvest-summary", getBatchHarvestSummary);

// --- Batch Sales & Single Resource Operations ---
router.get("/:batchId/sales", getBatchSales);
router.get("/:id", getBatchById);
router.put("/:id", updateBatch);
router.delete("/:id", deleteBatch);

module.exports = router;