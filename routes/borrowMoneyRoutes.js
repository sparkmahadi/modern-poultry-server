const express = require("express");
const {
  createBorrowRecord,
  getBorrowRecords,
  repayBorrowedLoan,
  updateBorrowRecord,
  deleteBorrowRecord
} = require("../controllers/borrowMoney.controller");

const router = express.Router();

router.get("/", getBorrowRecords);
router.post("/", createBorrowRecord);
router.put("/:id", updateBorrowRecord);
router.post("/:id/repay", repayBorrowedLoan);
router.delete("/:id", deleteBorrowRecord);

module.exports = router;