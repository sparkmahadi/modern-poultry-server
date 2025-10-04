const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');

// Routes
router.route('/').get(categoryController.getAllCategories).post(categoryController.addMainCategory)
// Fetch a single category by its 'id' (e.g., /api/utilities/categories/groceries)
router.route('/:id').get(categoryController.getCategory).delete(categoryController.deleteMainCategory)
    // Update the main category details
    .put(categoryController.updateMainCategory);

// Add a subcategory
router.route('/:categoryId/subcategories').post(categoryController.addSubcategory);

// Update a subcategory
router.route('/:categoryId/subcategories/:subId').put(categoryController.updateSubcategory)
    // Delete a subcategory
    .delete(categoryController.deleteSubcategory);

module.exports = router;
