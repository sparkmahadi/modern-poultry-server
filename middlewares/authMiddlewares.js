// backend/middlewares/authMiddleware.js
const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key";

function protect(req, res, next) {
  console.log('hit protect');
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Not authorized" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Token invalid" });
  }
}

module.exports = { protect };
