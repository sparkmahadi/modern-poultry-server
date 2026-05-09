const express = require('express');
const productController = require('../controllers/productController');
const purchaseController = require('../controllers/purchase.controller');

const router = express.Router();
// Routes
router.get('/', productController.getAllProducts);
router.get('/search', productController.searchProducts);
router.get('/:id', productController.getProduct);
router.post('/', productController.addProduct);
router.patch('/update-all-products-price', purchaseController.updateAllProductPrices);
router.put('/:id', productController.updateProduct);
router.delete('/:id', productController.deleteProduct);
module.exports = router;
