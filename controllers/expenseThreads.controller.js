const { ObjectId } = require("mongodb");
const { db } = require("../db.js");

const expenseThreadsCol = db.collection("expense_threads");

/* --------------------------------------------------
   GET ALL EXPENSE THREADS
-------------------------------------------------- */
async function getExpenseThreads(req, res) {
  try {
    const threads = await expenseThreadsCol
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      data: threads
    });
  } catch (error) {
    console.error("GET EXPENSE THREADS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch expense threads"
    });
  }
}

/* --------------------------------------------------
   GET SINGLE EXPENSE THREAD
-------------------------------------------------- */
async function getExpenseThreadById(req, res) {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid thread ID" });

    const thread = await expenseThreadsCol.findOne({ _id: new ObjectId(id) });

    if (!thread)
      return res.status(404).json({ success: false, message: "Thread not found" });

    return res.status(200).json({ success: true, data: thread });
  } catch (error) {
    console.error("GET THREAD ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch thread" });
  }
}

/* --------------------------------------------------
   CREATE EXPENSE THREAD
-------------------------------------------------- */
async function createExpenseThread(req, res) {
  try {
    const { name, cost, description } = req.body;

    if (!name || cost === undefined)
      return res.status(400).json({
        success: false,
        message: "Name and cost are required"
      });

    const payload = {
      name: name.trim(),
      cost: Number(cost),
      description: description || "",
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await expenseThreadsCol.insertOne(payload);

    return res.status(201).json({
      success: true,
      message: "Expense thread created successfully",
      data: { _id: result.insertedId, ...payload }
    });
  } catch (error) {
    console.error("CREATE THREAD ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create expense thread"
    });
  }
}

/* --------------------------------------------------
   UPDATE EXPENSE THREAD
-------------------------------------------------- */
async function updateExpenseThread(req, res) {
  try {
    const { id } = req.params;
    const { name, cost, description } = req.body;

    if (!ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid thread ID" });

    const updateDoc = {
      $set: {
        ...(name && { name: name.trim() }),
        ...(cost !== undefined && { cost: Number(cost) }),
        ...(description !== undefined && { description }),
        updatedAt: new Date()
      }
    };

    const result = await expenseThreadsCol.updateOne(
      { _id: new ObjectId(id) },
      updateDoc
    );

    if (!result.matchedCount)
      return res.status(404).json({ success: false, message: "Thread not found" });

    return res.status(200).json({
      success: true,
      message: "Expense thread updated successfully"
    });
  } catch (error) {
    console.error("UPDATE THREAD ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update expense thread"
    });
  }
}

/* --------------------------------------------------
   DELETE EXPENSE THREAD
-------------------------------------------------- */
async function deleteExpenseThread(req, res) {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid thread ID" });

    const result = await expenseThreadsCol.deleteOne({
      _id: new ObjectId(id)
    });

    if (!result.deletedCount)
      return res.status(404).json({ success: false, message: "Thread not found" });

    return res.status(200).json({
      success: true,
      message: "Expense thread deleted successfully"
    });
  } catch (error) {
    console.error("DELETE THREAD ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete expense thread"
    });
  }
}

module.exports = {
  getExpenseThreads,
  getExpenseThreadById,
  createExpenseThread,
  updateExpenseThread,
  deleteExpenseThread
};
