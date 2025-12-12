const express = require('express');
const { createPurchase, getPurchases, deletePurchase, getPurchaseById, updatePurchase, paySupplierDue } = require('../controllers/purchase.controllerv2');

const router = express.Router();

// router.route("/").get(createPurchase)
// Supplier-side purchase invoice
router.get("/", getPurchases);
router.get("/:id", getPurchaseById);
router.put("/:id", updatePurchase);
router.patch("/pay/:id", paySupplierDue);
router.delete("/:id", deletePurchase);
router.post("/", createPurchase);

module.exports = router;