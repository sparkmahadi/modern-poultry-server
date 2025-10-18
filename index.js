const express = require('express');
const cors = require('cors');
require('dotenv').config();
const jwt = require("jsonwebtoken");


const { connectToDB } = require('./db');


const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

connectToDB()
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

app.get('/', (req, res) => {
  res.send('🚀 Modern Poultry by Mahadi — running locally or on Vercel!');
});

// ✅ Run locally only if not in Vercel environment
if (process.env.NODE_ENV !== "PRODUCTION") {
  const port = process.env.PORT || 5000;
  app.listen(port, () => console.log(`✅ Server running locally on port ${port}`));
}



const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const purchaseRoutes = require('./routes/purchaseRoutes');
const salesRoutes = require('./routes/salesRoutes');
const productRoutes = require('./routes/productRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const customerRoutes = require('./routes/customerRoutes');

  const { ObjectId } = require('mongodb');
  const {db} = require('./db');
  const usersCollection = db.collection("users");


  // Middleware to verify the JWT token
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1]; // Extract token from 'Bearer token' format
  // console.log(token);

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }

    req.user = decoded; // Attach decoded user data to request object
    next();
  });
};

  // API to get user info
app.get('/api/auth/user', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id; // Assuming JWT payload has user id
    const query = { _id: new ObjectId(userId) };
    const user = await usersCollection.findOne(
      query,       // Query by ObjectId
      { projection: { password: 0 } }      // Exclude 'password' field
    );
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.send(user);
  } catch (error) {
    console.error('Error fetching user info:', error);
    res.status(500).json({ message: 'Server error' });
  }
});


// Routes
app.get('/', (req, res) => {
  res.send('Modern Poultry by Mahadi, Server is running')
})



app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
// app.use('/api/utilities', utilityRoutes);
app.use('/api/utilities/categories', categoryRoutes);
app.use("/api/purchases", purchaseRoutes);
app.use("/api/sales", salesRoutes);
app.use('/api/products', productRoutes);
app.use('/api/customers', customerRoutes);


// const supplierRoutes = require("./routes/supplierRoutes");
// app.use("/api/suppliers", supplierRoutes);


// const transactionRoutes = require("./routes/transactionRoutes");
// app.use("/api/transactions", transactionRoutes);

// const inventoryRoutes = require("./routes/inventoryRoutes");
// app.use("/api/inventory", inventoryRoutes);

// const cashRoutes = require("./routes/cashRoutes");
// app.use("/api/cash", cashRoutes);


// ✅ Export for Vercel
module.exports = app;
