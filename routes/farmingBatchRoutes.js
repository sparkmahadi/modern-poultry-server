const express = require("express");
const { createBatch, updateBatch, getBatches, getBatchById, deleteBatch } = require("../controllers/farmingbatch.controller");


const router = express.Router();

router.post("/", createBatch);
router.put("/:id", updateBatch);
router.get("/", getBatches);
router.get("/:id", getBatchById);
router.delete("/:id", deleteBatch);

module.exports = router;