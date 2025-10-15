// api/index.js
const { createServer } = require('@vercel/node');
const app = require('../backend/server'); // Path to your server.js

module.exports = createServer(app);
