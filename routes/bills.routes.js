const express = require("express");
const router = express.Router();

const {
  getBills,
  getBillById,
  createBill,
  updateBill,
  deleteBill
} = require("../controllers/bills.controller");

/* Base: /api/bills */

router.get("/", getBills);
router.get("/:id", getBillById);
router.post("/", createBill);
router.put("/:id", updateBill);
router.delete("/:id", deleteBill);

module.exports = router;
