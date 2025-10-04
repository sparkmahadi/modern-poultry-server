// backend/controllers/authController.js
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { loginUser } = require("../models/userModel");
const { db } = require("../db");

const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key";

const usersCollection = db.collection("users");

// Register Controller
module.exports.register = async (req, res) => {
  const { username, name, email, password } = req.body;

  if (!username || !name || !email || !password) {
    return res.status(400).json({ message: "All fields are required" });
  }

  try {
    const existingUser = await db.collection("users").findOne({ username });

    if (existingUser) {
      return res.json({ message: "Username already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    usersCollection.insertOne({
      username,
      name,
      email,
      role: "user",
      verification: false,
      approval: false,
      password: hashedPassword,
      info: { key: { secret: { pass: password } } },
      createdAt: new Date()
    });

    return res.json({ message: "User registered successfully" });
  } catch (err) {
    console.error("Registration error:", err);
    return res.json({ message: "Server error" });
  }
}


// Login Controller
module.exports.login = async (req, res) => {
  const { identifier, password } = req.body;
  console.log("Login attempt:", identifier);

  try {
    const user = await loginUser(identifier, password);

    const token = jwt.sign(
      { id: user._id, username: user.username },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({ token, username: user.username });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
};
