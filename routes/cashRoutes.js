const express = require("express");
const { getCash, addCash, withdrawCash } = require("../controllers/cash.controller");

const router = express.Router();

router.get("/", getCash);

router.post("/add", addCash);
router.post("/withdraw", withdrawCash);


module.exports = router;
