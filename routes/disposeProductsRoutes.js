const express = require("express");
const {
  createDisposal,
  getDisposals,
  getDisposalById,
  deleteDisposal
} = require("../controllers/disposeProducts.controller");

const router = express.Router();

router.get("/", getDisposals);
router.post("/", createDisposal);
router.get("/:id", getDisposalById);
router.delete("/:id", deleteDisposal);

module.exports = router;