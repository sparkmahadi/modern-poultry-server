const { MongoClient } = require("mongodb");

let uri;

if (process.env.ENVIRONMENT === "PRODUCTION") {
    uri = process.env.MONGO_URI;
  } else {
    uri = 'mongodb://localhost:27017';
  }
// console.log(uri);

const dbName = 'modern-poultry'

const client = new MongoClient(uri);

async function connectToDB() {
    try {
        await client.connect();
        console.log("Connected to MongoDB successfully!!!");
        const db = client.db(dbName);
        return db;
    } catch (err) {
        console.error('Error connecting to MongoDB:', err);
        throw err;
    }
}

module.exports = { connectToDB, db: client.db(dbName), client}