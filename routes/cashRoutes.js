const express = require("express");
const { getCash, addCash, withdrawCash, createCashAccount } = require("../controllers/cash.controller");

const router = express.Router();

router.get("/", getCash).post("/",createCashAccount);

router.post("/add", addCash);
router.post("/withdraw", withdrawCash);


module.exports = router;
