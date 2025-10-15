const express = require('express');
const utilityController = require('../controllers/utility.controller');

const router = express.Router();
// Public routes
router.route('/categories').get(utilityController.getProductCategories)
// .post(utilityController.postCategory);

// DELETE routes
// router.delete('/categories/:id', utilityController.deleteCategory); // DELETE request with ID in URL param
// router.delete('/:type/:id', utilityController.deleteUtility); // DELETE request with type and ID in URL params

// router.route("/categories/:id").delete(utilityController.deleteCategory);

module.exports = router;
