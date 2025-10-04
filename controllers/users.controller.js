const { ObjectId } = require('mongodb');
const bcrypt = require("bcrypt");
const { db } = require('../db');
const usersCollection = db.collection('users');

// Get all users
exports.getAllUsers = async (req, res) => {
  try {
    const users = await usersCollection.find({}).project({ password: 0 }).toArray();
    res.status(200).json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'An error occurred while fetching users.', error: error.message });
  }
};

// Create a new user
exports.createUser = async (req, res) => {
  try {
    const { username, name, email, role, password, verification, approval } = req.body;

    if (!username || !name || !email || !role || !password) {
      return res.status(400).json({ message: 'Missing required fields: username, name, email, role, and password are all necessary to create a user.' });
    }

    const existingUser = await usersCollection.findOne({
      $or: [{ username: username }, { email: email }]
    });
    if (existingUser) {
      return res.status(409).json({ message: 'A user with this username or email already exists. Please choose a different one.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = {
      username,
      name,
      email,
      role: role || 'viewer',
      verification: typeof verification === 'boolean' ? verification : false,
      approval: typeof approval === 'boolean' ? approval : false,
      password: hashedPassword,
      createdAt: new Date(),
    };

    const result = await usersCollection.insertOne(newUser);
    const createdUser = await usersCollection.findOne({ _id: result.insertedId }, { projection: { password: 0 } });
    res.status(201).json({ message: 'User created successfully.', user: createdUser });
  } catch (error) {
    console.error('Error creating user:', error);
    if (error.code === 11000) {
        return res.status(409).json({ message: 'A user with this username or email already exists.' });
    }
    res.status(500).json({ message: 'An internal server error occurred while creating the user.', error: error.message });
  }
};

// Update a user by ID (including secure password change)
exports.updateUser = async (req, res) => {
  console.log("\n--- UPDATE USER REQUEST START ---");
  try {
    const { id } = req.params;
    // Destructure all possible fields, including oldPassword and newPassword
    const { username, name, email, role, oldPassword, newPassword, verification, approval } = req.body;

    // --- CRITICAL DEBUGGING POINT 1: Check what's received in req.body ---
    console.log("1. Received User ID from params:", id);
    console.log("2. Received request body (req.body):", req.body);
    console.log("3. Extracted oldPassword:", oldPassword);
    console.log("4. Extracted newPassword:", newPassword);

    if (!ObjectId.isValid(id)) {
      console.log("5. Invalid User ID format detected.");
      return res.status(400).json({ message: 'Invalid User ID format provided. Please ensure the ID is a valid MongoDB ObjectId.' });
    }

    // Prepare data for update. Only include fields that are explicitly provided (not undefined).
    const updateData = {};
    if (username !== undefined) updateData.username = username;
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (role !== undefined) updateData.role = role;
    // Ensure verification and approval are boolean, default to false if not provided or invalid
    if (verification !== undefined) updateData.verification = typeof verification === 'boolean' ? verification : false;
    if (approval !== undefined) updateData.approval = typeof approval === 'boolean' ? approval : false;

    updateData.updatedAt = new Date(); // Always update timestamp

    // --- Secure Password Change Logic ---
    // This condition checks if there's any intention to change password
    if (oldPassword || newPassword) {
        console.log("6. Password change attempt detected.");

        // This condition checks if both old and new passwords are provided
        if (!oldPassword || !newPassword) {
            console.log("7. Missing old or new password for change.");
            return res.status(400).json({ message: 'To change password, both current password and new password are required.' });
        }

        // 1. Fetch the user to get the stored hashed password
        console.log("8. Attempting to find user in DB for password verification...");
        const user = await usersCollection.findOne({ _id: new ObjectId(id) });

        if (!user) {
            console.log("9. User NOT found in DB for password change. ID:", id);
            return res.status(404).json({ message: `No user found with the ID: ${id} for password change.` });
        }
        console.log("10. User found for password change. Hashed password:", user.password);


        // 2. Compare provided old password with stored hash
        console.log("11. Comparing provided old password with stored hash...");
        const isPasswordValid = await bcrypt.compare(oldPassword, user.password);

        if (!isPasswordValid) {
            console.log("12. Provided current password is INCORRECT.");
            return res.status(401).json({ message: 'The current password you provided is incorrect.' });
        }
        console.log("13. Provided current password is CORRECT.");

        // 3. Hash the new password and add it to updateData
        updateData.password = await bcrypt.hash(newPassword, 10);
        console.log("14. New password hashed and added to updateData. Password length:", updateData.password.length);
    }

    const result = await usersCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updateData },
      { returnDocument: 'after', projection: { password: 0 } } // projection: { password: 0 } means it won't return the password field
    );

    console.log("16. MongoDB findOneAndUpdate result:", result);
    if (!result._id) { // As per your previous fix
      console.log("17. MongoDB update reported no user found or failed to return _id.");
      return res.status(404).json({ message: `No user found with the ID: ${id}. The user could not be updated.` });
    }

    console.log("18. User updated successfully in MongoDB.");
    res.status(200).json({ message: 'User updated successfully.', user: result.value });
  } catch (error) {
    console.error('19. Error updating user:', error);
    res.status(500).json({ message: 'An internal server error occurred while updating the user.', error: error.message });
  }
  console.log("--- UPDATE USER REQUEST END ---\n");
};

// Delete a user by ID
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid User ID format provided. Please ensure the ID is a valid MongoDB ObjectId.' });
    }

    const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: `No user found with the ID: ${id}. The user could not be deleted.` });
    }
    res.status(200).json({ message: 'User deleted successfully.' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ message: 'An internal server error occurred while deleting the user.', error: error.message });
  }
};