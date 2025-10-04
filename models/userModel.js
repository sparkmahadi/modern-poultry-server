
const {db} = require("../db");
const bcrypt = require("bcrypt");

const usersCollection = db.collection("users");


// Login user using username or email
async function loginUser(identifier, password) {

  const user = await usersCollection.findOne({
    $or: [{ username: identifier }, { email: identifier }],
  });

  if (!user) {
    throw new Error("Invalid credentials");
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    throw new Error("Invalid credentials");
  }

  return user;
}



module.exports = {  loginUser };
