const express = require('express');
const { createPurchase, getPurchases, deletePurchase, getPurchaseById, updatePurchase, paySupplierDue, getPurchaseReport, getPurchasesBySupplierId, paySupplierDueManually, getProductWisePurchaseRecord, createPurchaseReturn,
    getPurchaseReturns, getPurchaseReturnById } = require('../controllers/purchase.controller');

const router = express.Router();

// Add Purchase Return Route
// --- PURCHASE RETURN ROUTES (Must come before generic :id routes) ---
router.get("/returns", getPurchaseReturns);
router.post("/return", createPurchaseReturn);
router.get("/returns/:id", getPurchaseReturnById);


// Supplier-side purchase invoice
router.get("/", getPurchases);
router.get("/reports/:type", getPurchaseReport);
router.get("/supplier-purchases/:supplierId", getPurchasesBySupplierId);
router.get("/product-purchases", getProductWisePurchaseRecord);
router.get("/:id", getPurchaseById);

router.put("/:id", updatePurchase);

router.patch("/pay/:id", paySupplierDue);
router.patch("/pay-supplier-due-manually", paySupplierDueManually)

router.delete("/:id", deletePurchase);
router.post("/", createPurchase);




module.exports = router;