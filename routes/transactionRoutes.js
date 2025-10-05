// routes/transactionRoutes.js
const express = require('express');
const { createTransaction, getTransactions, getTransactionById, updateTransaction, deleteTransaction } = require('../controllers/transaction.controller');
const router = express.Router();

router.post('/', createTransaction);
router.get('/', getTransactions);
router.get('/:id', getTransactionById);
router.put('/:id', updateTransaction);
router.delete('/:id', deleteTransaction);

module.exports = router;
