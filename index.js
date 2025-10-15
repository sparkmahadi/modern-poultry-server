const express = require('express');
const cors = require('cors');
require('dotenv').config();
const jwt = require("jsonwebtoken");

const { connectToDB, db } = require('./db');
const { ObjectId } = require('mongodb');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Collections
const usersCollection = db.collection("users");

// JWT middleware
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token provided' });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ message: 'Invalid or expired token' });
    req.user = decoded;
    next();
  });
};

// Routes
app.get('/', (req, res) => res.send('Modern Poultry by Mahadi, Server is running'));

app.get('/api/auth/user', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const query = { _id: new ObjectId(userId) };
    const user = await usersCollection.findOne(query, { projection: { password: 0 } });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (error) {
    console.error('Error fetching user info:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Import route modules
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const purchaseRoutes = require('./routes/purchaseRoutes');
const salesRoutes = require('./routes/salesRoutes');
const productRoutes = require('./routes/productRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const customerRoutes = require('./routes/customerRoutes');
const supplierRoutes = require('./routes/supplierRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const inventoryRoutes = require('./routes/inventoryRoutes');
const cashRoutes = require('./routes/cashRoutes');

// Use routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/utilities/categories', categoryRoutes);
app.use("/api/purchases", purchaseRoutes);
app.use("/api/sales", salesRoutes);
app.use('/api/products', productRoutes);
app.use('/api/customers', customerRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/cash", cashRoutes);

// Connect to DB
connectToDB()
  .then(() => console.log("MongoDB Connected!"))
  .catch(err => console.error("MongoDB Connection Error:", err));

// ✅ Only listen if running locally
if (process.env.ENVIRONMENT !== "PRODUCTION") {
  const port = process.env.PORT || 5000;
  app.listen(port, () => {
    console.log(`Modern Poultry server is running locally on port ${port}`);
  });
}

module.exports = app; // Export app for Vercel
