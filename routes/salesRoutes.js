const express = require("express");
const { createSell, getSales, getCashSales, getDueSales } = require("../controllers/sales.controller");

const router = express.Router();

// Basic sell memo
router.get("/", getSales);
router.get("/cash-sales", getCashSales);
router.get("/due-sales", getDueSales);
router.post("/create", createSell);

module.exports = router;
