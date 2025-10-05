const express = require("express");
const { createSell, getSales } = require("../controllers/sales.controller");

const router = express.Router();

// Basic sell memo
router.get("/", getSales);
router.post("/create", createSell);

module.exports = router;
