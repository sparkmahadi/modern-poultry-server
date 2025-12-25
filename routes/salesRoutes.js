const express = require("express");
const { createSell, getSales, getSaleById, updateSaleById, getSalesByCustomerId, receiveCustomerDue, deleteSale, getSalesReport, receiveCustomerDueManually } = require("../controllers/sales.controller");

const router = express.Router();

// Basic sell memo
router.get("/", getSales);
router.get("/reports/:type", getSalesReport);

router.post("/create", createSell);

router.patch("/receive-customer-due/:saleId", receiveCustomerDue)
router.patch("/receive-customer-due-manually", receiveCustomerDueManually)

// New routes for single sale
router.get("/customer-sales/:customerId", getSalesByCustomerId);
router.get("/:id", getSaleById);
router.put("/:id", updateSaleById);
router.delete("/:id", deleteSale);

module.exports = router;
