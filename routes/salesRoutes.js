const express = require("express");
const { createSell, getSales, getCashSales, getDueSales, getSaleById, updateSaleById, getSalesByCustomerId, receiveCustomerDue, deleteSale } = require("../controllers/sales.controller");

const router = express.Router();

// Basic sell memo
router.get("/", getSales);
// router.get("/cash-sales", getCashSales);
// router.get("/due-sales", getDueSales);
router.post("/create", createSell);

router.patch("/receive-customer-due/:saleId", receiveCustomerDue)

// New routes for single sale
router.get("/customer-sales/:customerId", getSalesByCustomerId);
router.get("/:id", getSaleById);
router.put("/:id", updateSaleById);
router.delete("/:id", deleteSale);

module.exports = router;
