const express = require('express');
const { createPurchase, getPurchases, deletePurchase, getPurchaseById, updatePurchase, paySupplierDue, getPurchaseReport, getPurchasesBySupplierId, paySupplierDueManually } = require('../controllers/purchase.controller');

const router = express.Router();

// router.route("/").get(createPurchase)
// Supplier-side purchase invoice
router.get("/", getPurchases);
router.get("/reports/:type", getPurchaseReport);
router.get("/supplier-purchases/:supplierId", getPurchasesBySupplierId);
router.get("/:id", getPurchaseById);

router.put("/:id", updatePurchase);

router.patch("/pay/:id", paySupplierDue);
router.patch("/pay-supplier-due-manually", paySupplierDueManually)

router.delete("/:id", deletePurchase);
router.post("/", createPurchase);

module.exports = router;