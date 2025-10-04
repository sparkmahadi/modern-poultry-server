const express = require('express');
const router = express.Router();
const { createPurchase } = require('../controllers/purchase.controller');


// router.route("/").get(createPurchase)
// Supplier-side purchase invoice
router.post("/", createPurchase);

module.exports = router;