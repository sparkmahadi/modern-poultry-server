const express = require("express");
const supplierController = require("../controllers/supplier.controller");

const router = express.Router();
router.get("/", supplierController.getSuppliers);
router.get("/search", supplierController.searchSuppliers); // <-- Search endpoint
router.post("/", supplierController.createSupplier);

router.get("/:id", supplierController.getSupplierById);
router.put("/:id", supplierController.updateSupplier);
router.delete("/:id", supplierController.deleteSupplier);

module.exports = router;
