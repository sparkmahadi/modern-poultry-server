const express = require("express");
const { createSell } = require("../controllers/sales.controller");

const router = express.Router();

// Basic sell memo
router.post("/", createSell);

module.exports = router;
