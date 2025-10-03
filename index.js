// backend/server.js
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const jwt = require("jsonwebtoken");


const { connectToDB } = require('./db');


const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Connect to MongoDB
connectToDB()
  .then(() => {
    app.listen(port, () => { console.log(`Modern Poultry server is running on port ${port}`); })
  })
  .catch((err) => {
    console.error('Error starting server:', err);
  });

  const {db} = require('./db');

// Routes
app.get('/', (req, res) => {
  res.send('Modern Poultry by Mahadi, Server is running')
})