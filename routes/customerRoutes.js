const express = require("express");
const {
  createCustomer,
  getCustomers,
  updateCustomer,
  deleteCustomer,
} = require("../controllers/customer.controller");

const router = express.Router();

router.post("/", createCustomer);
router.get("/", getCustomers);
router.put("/:id", updateCustomer);
router.delete("/:id", deleteCustomer);

module.exports = router;
