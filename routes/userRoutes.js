// routes/userRoutes.js
const express = require('express');
const userController = require('../controllers/users.controller'); // Import the controller
const router = express.Router();

// Middleware for authentication and authorization (simplified for this example)
// IMPORTANT: Implement actual authentication and role checking here.
const authorizeAdmin = (req, res, next) => {
  // For demonstration, bypassing auth. YOU MUST ADD REAL AUTH.
  console.log("WARNING: Admin authorization bypassed for demonstration. Implement real auth!");
  next();
};

// GET all users
router.get('/', authorizeAdmin, userController.getAllUsers);

// POST create new user
router.post('/', authorizeAdmin, userController.createUser);

// PUT update user by ID
router.put('/:id', authorizeAdmin, userController.updateUser);

// DELETE user by ID
router.delete('/:id', authorizeAdmin, userController.deleteUser);

module.exports = router;