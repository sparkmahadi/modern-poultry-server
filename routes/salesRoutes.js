const express = require("express");
const { createSell, getSales, getSaleById, updateSaleById, getSalesByCustomerId, receiveCustomerDue, deleteSale, getSalesReport, receiveCustomerDueManually, getProductWiseSellRecord,
    createSalesReturn,
    getSalesReturns,
    getSalesReturnById,
    updateSalesReturnById, deleteSalesReturn
} = require("../controllers/sales.controller");

const router = express.Router();

// --- 🆕 SALES RETURN ROUTES (Must precede :id) ---
router.get("/returns", getSalesReturns);
router.get("/returns/:id", getSalesReturnById);
router.post("/return", createSalesReturn);
router.put("/returns/:id", updateSalesReturnById);
router.delete("/returns/:id", deleteSalesReturn);

// Basic sell memo
router.get("/", getSales);
router.get("/product-sales", getProductWiseSellRecord);
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
