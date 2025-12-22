const express = require("express");
const router = express.Router();

const {
  getExpenseThreads,
  getExpenseThreadById,
  createExpenseThread,
  updateExpenseThread,
  deleteExpenseThread
} = require("../controllers/expenseThreads.controller");

/* Base route: /api/expense-threads */

router.get("/", getExpenseThreads);
router.get("/:id", getExpenseThreadById);
router.post("/", createExpenseThread);
router.put("/:id", updateExpenseThread);
router.delete("/:id", deleteExpenseThread);

module.exports = router;
