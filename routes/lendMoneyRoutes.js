const express = require("express");
const {
  createLendRecord,
  getLendRecords,
  receiveRepayment,
  updateLendRecord, // 👈 Import here
  deleteLendRecord
} = require("../controllers/lendMoney.controller");

const router = express.Router();


router.get("/", getLendRecords);
router.post("/", createLendRecord);
router.put("/:id", updateLendRecord); // 👈 Register route here
router.post("/:id/repay", receiveRepayment);
router.delete("/:id", deleteLendRecord);

module.exports = router;