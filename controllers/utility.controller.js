const { db } = require("../db");
const { ObjectId } = require("mongodb");

const productCategoriesCollection = db.collection("categories");
const samplesCollection = db.collection("samples");
const utilitiesCollection = db.collection("utilities");

// Get all SampleCategories
module.exports.getProductCategories = async (req, res) => {
  console.log('GET /Categories');
  try {
    const result = await productCategoriesCollection.find().toArray();
    res.status(200).json({
      success: true,
      message: `${result.length} Product Categories found`,
      data: result,
    });
  } catch (error) {
    console.error('Error fetching Product Categories:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

module.exports.deleteCategory = async (req, res) => {
  const { id } = req.params;
  console.log('attempt delete category');
  try {
    const result = await productCategoriesCollection.deleteOne({ _id: new ObjectId(id) });
    console.log(result);
    if (result.deletedCount > 0) {
      res.send({ success: true, message: 'Category deleted successfully' });
    } else {
      res.send({ success: false, message: "Category not found" });
    }
  } catch (error) {
    res.status(500).send({ message: 'Error deleting category', error });
  }
};

module.exports.postCategory = async (req, res) => {
  const { cat_name, status, totalSamples, createdBy } = req.body;
  console.log(cat_name, status, totalSamples, createdBy);
  if (!cat_name || !status || !totalSamples || createdBy === undefined) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  try {
    // Check for existing category with same cat_name and buyer_name
    const existingCategory = await productCategoriesCollection.findOne({
      cat_name: cat_name.trim()
    });
    if (existingCategory) {
      return res.send({
        success: false,
        redirect: true,
        message: 'A category with the same name and buyer already exists',
      });
    }

    // If no duplicate, insert new category
    const newCategory = { cat_name, status, totalSamples, createdBy, createdAt: new Date() };
    const result = await productCategoriesCollection.insertOne(newCategory);
console.log(result);
    if (result.acknowledged) {
      return res.status(201).json({
        success: true,
        message: 'Added Sample Category Successfully!!!',
      });
    } else {
      return res.status(500).json({ success: false, message: 'Insertion failed' });
    }
  } catch (error) {
    console.error('Error creating category:', error);
    return res.status(500).json({ success: false, message: 'Server error', error });
  }
}

// Controller for creating a new Buyer
module.exports.postBuyer = async (req, res) => {
  console.log("post buyer");
  const { value, createdBy } = req.body; // Destructure 'createdBy' from req.body
  console.log(value, createdBy);
  if (!value || value.trim() === '') {
    return res.status(400).json({ success: false, message: 'Buyer name is required' });
  }
  // Add validation for createdBy
  if (!createdBy || createdBy.trim() === '') {
    return res.status(400).json({ success: false, message: 'Creator information is required' });
  }

  try {
    const existingBuyer = await utilitiesCollection.findOne({
      utility_type: 'buyer', // Renamed from 'type'
      value: value.trim(),    // Renamed from 'name'
    });

    if (existingBuyer) {
      return res.send({
        success: false,
        redirect: true,
        message: 'A buyer with this name already exists',
      });
    }

    const newBuyer = {
      utility_type: 'buyer',
      value: value.trim(),
      createdBy: createdBy.trim(), // Assign createdBy
      createdAt: new Date()
    };
    const result = await utilitiesCollection.insertOne(newBuyer);

    if (result.acknowledged) {
      return res.status(201).json({
        success: true,
        message: 'Buyer added successfully!',
      });
    } else {
      return res.status(500).json({ success: false, message: 'Insertion failed' });
    }
  } catch (error) {
    console.error('Error creating buyer:', error);
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Controller for creating a new Status
module.exports.postStatus = async (req, res) => {
  const { value, createdBy } = req.body; // Destructure 'createdBy' from req.body

  if (!value || value.trim() === '') {
    return res.status(400).json({ success: false, message: 'Status name is required' });
  }
  // Add validation for createdBy
  if (!createdBy || createdBy.trim() === '') {
    return res.status(400).json({ success: false, message: 'Creator information is required' });
  }

  try {
    const existingStatus = await utilitiesCollection.findOne({
      utility_type: 'status', // Renamed from 'type'
      value: value.trim(),    // Renamed from 'name'
    });

    if (existingStatus) {
      return res.send({
        success: false,
        redirect: true,
        message: 'A status with this name already exists',
      });
    }

    const newStatus = {
      utility_type: 'status',
      value: value.trim(),
      createdBy: createdBy.trim(), // Assign createdBy
      createdAt: new Date()
    };
    const result = await utilitiesCollection.insertOne(newStatus);

    if (result.acknowledged) {
      return res.status(201).json({
        success: true,
        message: 'Status added successfully!',
      });
    } else {
      return res.status(500).json({ success: false, message: 'Insertion failed' });
    }
  } catch (error) {
    console.error('Error creating status:', error);
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Controller for creating a new Shelf
module.exports.postShelf = async (req, res) => {
  const { value, createdBy } = req.body; // Destructure 'createdBy' from req.body

  if (!value || String(value).trim() === '') {
    return res.status(400).json({ success: false, message: 'Shelf number is required' });
  }
  // Add validation for createdBy
  if (!createdBy || createdBy.trim() === '') {
    return res.status(400).json({ success: false, message: 'Creator information is required' });
  }

  try {
    const existingShelf = await utilitiesCollection.findOne({
      utility_type: 'shelf', // Renamed from 'type'
      value: String(value).trim(), // Renamed from 'number'
    });

    if (existingShelf) {
      return res.send({
        success: false,
        redirect: true,
        message: 'A shelf with this number already exists',
      });
    }

    const newShelf = {
      utility_type: 'shelf',
      value: String(value).trim(),
      createdBy: createdBy.trim(), // Assign createdBy
      createdAt: new Date()
    };
    const result = await utilitiesCollection.insertOne(newShelf);

    if (result.acknowledged) {
      return res.status(201).json({
        success: true,
        message: 'Shelf added successfully!',
      });
    } else {
      return res.status(500).json({ success: false, message: 'Insertion failed' });
    }
  } catch (error) {
    console.error('Error creating shelf:', error);
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Controller for creating a new Division
module.exports.postDivision = async (req, res) => {
  const { value, createdBy } = req.body; // Destructure 'createdBy' from req.body

  if (!value || String(value).trim() === '') {
    return res.status(400).json({ success: false, message: 'Division number is required' });
  }
  // Add validation for createdBy
  if (!createdBy || createdBy.trim() === '') {
    return res.status(400).json({ success: false, message: 'Creator information is required' });
  }

  try {
    const existingDivision = await utilitiesCollection.findOne({
      utility_type: 'division', // Renamed from 'type'
      value: String(value).trim(), // Renamed from 'number'
    });

    if (existingDivision) {
      return res.send({
        success: false,
        redirect: true,
        message: 'A division with this number already exists',
      });
    }

    const newDivision = {
      utility_type: 'division',
      value: String(value).trim(),
      createdBy: createdBy.trim(), // Assign createdBy
      createdAt: new Date()
    };
    const result = await utilitiesCollection.insertOne(newDivision);

    if (result.acknowledged) {
      return res.status(201).json({
        success: true,
        message: 'Division added successfully!',
      });
    } else {
      return res.status(500).json({ success: false, message: 'Insertion failed' });
    }
  } catch (error) {
    console.error('Error creating division:', error);
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Controller to get all Buyers
module.exports.getBuyers = async (req, res) => {
  try {
    const buyers = await utilitiesCollection.find({ utility_type: 'buyer' }).toArray();
    if (buyers.length > 0) {
      return res.status(200).json({
        success: true,
        message: 'Buyers retrieved successfully!',
        data: buyers,
      });
    } else {
      return res.status(404).json({
        success: false,
        message: 'No buyers found.',
        data: [],
      });
    }
  } catch (error) {
    console.error('Error fetching buyers:', error);
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Controller to get all Statuses
module.exports.getStatuses = async (req, res) => {
  try {
    const statuses = await utilitiesCollection.find({ utility_type: 'status' }).toArray();
    if (statuses.length > 0) {
      return res.status(200).json({
        success: true,
        message: 'Statuses retrieved successfully!',
        data: statuses,
      });
    } else {
      return res.status(404).json({
        success: false,
        message: 'No statuses found.',
        data: [],
      });
    }
  } catch (error) {
    console.error('Error fetching statuses:', error);
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Controller to get all Shelves
module.exports.getShelves = async (req, res) => {
  console.log('hit getshelves');
  try {
    const shelves = await utilitiesCollection.find({ utility_type: 'shelf' }).toArray();
    if (shelves.length > 0) {
      return res.status(200).json({
        success: true,
        message: 'Shelves retrieved successfully!',
        data: shelves,
      });
    } else {
      return res.status(404).json({
        success: false,
        message: 'No shelves found.',
        data: [],
      });
    }
  } catch (error) {
    console.error('Error fetching shelves:', error);
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Controller to get all Divisions
module.exports.getDivisions = async (req, res) => {
  try {
    const divisions = await utilitiesCollection.find({ utility_type: 'division' }).toArray();
    if (divisions.length > 0) {
      return res.status(200).json({
        success: true,
        message: 'Divisions retrieved successfully!',
        data: divisions,
      });
    } else {
      return res.status(404).json({
        success: false,
        message: 'No divisions found.',
        data: [],
      });
    }
  } catch (error) {
    console.error('Error fetching divisions:', error);
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};



// Controller to update an existing Category
module.exports.updateCategory = async (req, res) => {
  console.log('update category');
  const { _id, cat_name, status, totalSamples, createdBy } = req.body;

  if (!_id || !cat_name || !status || totalSamples === undefined || !createdBy) {
    return res.status(400).json({ success: false, message: 'Missing required fields for update' });
  }

  try {
    const objectId = new ObjectId(_id); // Convert string ID to ObjectId

    const result = await productCategoriesCollection.updateOne(
      { _id: objectId },
      {
        $set: {
          cat_name: cat_name.trim(),
          status: status.trim(),
          totalSamples: Number(totalSamples),
          createdBy: createdBy.trim(),
          updatedAt: new Date() // Add an updatedAt timestamp
        }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    if (result.modifiedCount === 0) {
      return res.status(200).json({ success: true, message: 'No changes detected for category' });
    }

    return res.status(200).json({ success: true, message: 'Category updated successfully!' });
  } catch (error) {
    console.error('Error updating category:', error);
    if (error.name === 'BSONError') { // Catch invalid ObjectId format
      return res.status(400).json({ success: false, message: 'Invalid Category ID format' });
    }
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Controller to update an existing Utility (Buyer, Status, Shelf, Division)
module.exports.updateUtility = async (req, res) => {
  console.log("update utility");
  const { _id, utility_type, value, createdBy } = req.body;
  console.log(_id, utility_type, value, createdBy);
  if (!_id || !utility_type || !value || !createdBy) {
    return res.status(400).json({ success: false, message: 'Missing required fields for update' });
  }

  try {
    const objectId = new ObjectId(_id); // Convert string ID to ObjectId

    const result = await utilitiesCollection.updateOne(
      { _id: objectId, utility_type: utility_type.trim() }, // Ensure type matches too
      {
        $set: {
          value: value.trim(),
          createdBy: createdBy.trim(),
          updatedAt: new Date() // Add an updatedAt timestamp
        }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: `${utility_type} not found or type mismatch` });
    }
    if (result.modifiedCount === 0) {
      return res.status(200).json({ success: true, message: `No changes detected for ${utility_type}` });
    }

    return res.status(200).json({ success: true, message: `${utility_type} updated successfully!` });
  } catch (error) {
    console.error('Error updating utility:', error);
    if (error.name === 'BSONError') { // Catch invalid ObjectId format
      return res.status(400).json({ success: false, message: 'Invalid Utility ID format' });
    }
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// --- DELETE Controllers ---

// Controller to delete an existing Category
module.exports.deleteCategory = async (req, res) => {
  const { id } = req.params; // Expect ID in URL params

  if (!id) {
    return res.status(400).json({ success: false, message: 'Category ID is required for deletion' });
  }

  try {
    const objectId = new ObjectId(id); // Convert string ID to ObjectId
    const result = await productCategoriesCollection.deleteOne({ _id: objectId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    return res.status(200).json({ success: true, message: 'Category deleted successfully!' });
  } catch (error) {
    console.error('Error deleting category:', error);
    if (error.name === 'BSONError') {
      return res.status(400).json({ success: false, message: 'Invalid Category ID format' });
    }
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Controller to delete an existing Utility (Buyer, Status, Shelf, Division)
module.exports.deleteUtility = async (req, res) => {
  console.log('hit delete utility');
  const { id, type } = req.params; // Expect ID and type in URL params
  console.log(id, type);
  if (!id || !type) {
    return res.status(400).json({ success: false, message: 'Utility ID and type are required for deletion' });
  }

  try {
    const objectId = new ObjectId(id); // Convert string ID to ObjectId
    console.log(objectId);
    const result = await utilitiesCollection.deleteOne({ _id: objectId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: `${type} not found or type mismatch` });
    }

    return res.status(200).json({ success: true, message: `${type} deleted successfully!` });
  } catch (error) {
    console.error('Error deleting utility:', error);
    if (error.name === 'BSONError') {
      return res.status(400).json({ success: false, message: 'Invalid Utility ID format' });
    }
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

exports.convertFieldsToNumbers = async (req, res) => {
  console.log('hit convert positions');

  try {
    // ✅ Step 1: Normalize all shelf, division, and position fields to numbers
    let updatedCount = 0;

    const cursor = samplesCollection.find({});

    for await (const doc of cursor) {
      const update = {};
      const numericShelf = parseInt(doc.shelf);
      const numericDivision = parseInt(doc.division);
      const numericPosition = parseInt(doc.position);

      if (!isNaN(numericShelf)) update.shelf = numericShelf;
      if (!isNaN(numericDivision)) update.division = numericDivision;
      if (!isNaN(numericPosition)) update.position = numericPosition;

      if (Object.keys(update).length > 0) {
        const result = await samplesCollection.updateOne({ _id: doc._id }, { $set: update });
        if (result.modifiedCount) {
          updatedCount++;
        }
        console.log(result, updatedCount);
      }
    }

    if (updatedCount > 0) {
      res.json({
        success: true,
        message: `${updatedCount} Fields converted successfully`,
      });
    } else {
      res.json({
        message: 'No matching documents found to convert',
      });
    }

  } catch (err) {
    console.error('convertion Error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};
