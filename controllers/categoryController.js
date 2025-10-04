const { db } = require('../db');
const categoriesCollection = db.collection('categories');

// Helper function to normalize _id from MongoDB's ObjectId to a string ($oid)
const normalizeMongoId = (doc) => {
    if (doc && doc._id) {
        // Check if _id is an instance of ObjectId before calling toHexString
        if (typeof doc._id.toHexString === 'function') {
            doc._id = { "$oid": doc._id.toHexString() };
        }
        // If it's already in the "$oid" format (e.g., from a previous normalization), leave it
        // else if (typeof doc._id === 'object' && doc._id.$oid) { /* do nothing */ }
    }
    return doc;
};

// @desc    Get all categories or a single category by its 'id' field
// @route   GET /api/utilities/categories/:id (single)
// @route   GET /api/utilities/categories (all)
// @access  Public
exports.getCategory = async (req, res) => {
    try {
        const { id } = req.params;

        if (id) {
            // Get a single category
            const category = await categoriesCollection.findOne({ id: id });
            if (!category) {
                return res.status(404).json({ success: false, message: 'Category not found' });
            }
            res.status(200).json({ success: true, data: normalizeMongoId(category) });
        } else {
            // Get all categories
            const allCategories = await categoriesCollection.find({}).toArray();
            const normalizedCategories = allCategories.map(normalizeMongoId);
            res.status(200).json({ success: true, message: `${normalizedCategories.length} categories found`, data: normalizedCategories });
        }
    } catch (error) {
        console.error('Error fetching category(s):', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Add a new main category
// @route   POST /api/utilities/categories
// @access  Public
/**
 * Helper function to create a slug from a string.
 * @param {string} name The string to convert to a slug.
 * @returns {string} The generated slug.
 */
const createSlug = (name) => {
    return name
        .toLowerCase()
        .replace(/\s+/g, '_')           // Replace spaces with underscores
        .replace(/[^\w-]+/g, '')       // Remove all non-word chars
        .replace(/--+/g, '_')          // Replace multiple underscores with a single one
        .replace(/^-+/, '')            // Trim - from start of text
        .replace(/-+$/, '');           // Trim - from end of text
};


/**
 * @function addMainCategory
 * @description Adds a new main category, generating a slug-like ID (e.g., "housing_utilities")
 * and ensuring uniqueness of category name and ID.
 * @param {Object} req - Express request object.
 * @param {Object} req.body - Contains { name, color, icon }.
 * @param {Object} res - Express response object.
 */
exports.addMainCategory = async (req, res) => {
    try {
        const { name, color, icon } = req.body;

        // 1. Validate required fields
        if (!name || typeof name !== 'string' || name.trim() === '') {
            return res.status(400).json({ success: false, message: 'Category name is required and cannot be empty.' });
        }

        const trimmedName = name.trim();

        // 2. Check for duplicate category name to ensure logical uniqueness
        const existingCategoryByName = await categoriesCollection.findOne({ name: trimmedName });
        if (existingCategoryByName) {
            return res.status(409).json({ success: false, message: `A category with the name '${trimmedName}' already exists.` });
        }

        // 3. Generate the new slug-like category ID
        let baseSlug = createSlug(trimmedName);
        let newCategoryId = baseSlug;
        let counter = 0;

        // Check for ID uniqueness and append counter if necessary
        while (await categoriesCollection.findOne({ id: newCategoryId })) {
            counter++;
            newCategoryId = `${baseSlug}_${counter}`;
        }

        // 4. Construct the new category object
        const newCategory = {
            id: newCategoryId, // Assign the backend-generated slug-like ID
            name: trimmedName,
            color: color || '#607D8B', // Default color if not provided
            icon: icon || 'tag',       // Default icon if not provided
            subcategories: []          // New main categories start with an empty subcategories array
        };

        // 5. Insert the new category into the database
        const result = await categoriesCollection.insertOne(newCategory);

        // 6. Check insertion result and return response
        if (result.acknowledged && result.insertedId) {
            // Fetch the newly inserted document to return its full, fresh state to the frontend.
            const insertedCategory = await categoriesCollection.findOne({ _id: result.insertedId });
            return res.status(201).json({
                success: true,
                data: normalizeMongoId(insertedCategory),
                message: 'Category added successfully.',
                newCategoryId: newCategoryId // Optionally return the generated ID
            });
        } else {
            // This case should ideally not be hit if `acknowledged` is true but `insertedId` is missing,
            // but it's a good safeguard.
            return res.status(500).json({ success: false, message: "Failed to add category due to an unknown database issue." });
        }
    } catch (error) {
        console.error('Error adding new main category:', error);
        // MongoDB duplicate key error (if 'id' or 'name' had a unique index and this check was somehow missed)
        if (error.code === 11000) {
            // This could happen if a race condition leads to a duplicate ID before the while loop checks it,
            // or if a unique index on 'name' caught it.
            return res.status(409).json({ success: false, message: `A category with the provided details already exists.` });
        }
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};


// @desc    Update main category details
// @route   PUT /api/utilities/categories/:id
// @access  Public
exports.updateMainCategory = async (req, res) => {
    console.log('hit updateMainCategory');
    try {
        const { id } = req.params;
        const { name, color, icon } = req.body; // Added 'icon' for completeness

        if (!name && !color && !icon) { // Check if at least one field to update is provided
            return res.status(400).json({ success: false, message: 'At least one of name, color, or icon is required for main category update.' });
        }

        const updateFields = {};
        if (name) updateFields.name = name.trim();
        if (color) updateFields.color = color;
        if (icon) updateFields.icon = icon;

        const result = await categoriesCollection.updateOne(
            { id: id },
            { $set: updateFields },
            { returnDocument: 'after' } // This ensures result.value contains the updated document
        );

        // findOneAndUpdate returns an object with a 'value' property if a document was found and updated
        if (result.modifiedCount > 0) {
            return res.status(200).json({ success: true, data: normalizeMongoId(result.value), message: 'Main category updated successfully.' });
        } else {
            // If result.value is null, it means no document matched the query.
            return res.status(404).json({ success: false, message: 'Category not found or no changes were made.' });
        }
    } catch (error) {
        console.error('Error updating main category:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Add a new subcategory to a category
// @route   POST /api/utilities/categories/:categoryId/subcategories
// @access  Public
exports.addSubcategory = async (req, res) => {
    try {
        const { categoryId } = req.params;
        // Destructure fields expected from the frontend. 'id' for subcategory is now generated here.
        const { name, monthly_limit, color, icon } = req.body;

        // 1. Validate essential fields: name and monthly_limit are required from the frontend
        if (!name || typeof monthly_limit === 'undefined') {
            return res.status(400).json({ success: false, message: 'New subcategory must have a name and monthly_limit.' });
        }

        const trimmedSubcategoryName = name.trim();

        // 2. Find the parent category by its ID
        // Using findOneAndUpdate would be more atomic for this operation in a real-world high-concurrency scenario
        // but for clarity and consistency with previous examples, we'll use findOne then updateOne.
        const categoryToUpdate = await categoriesCollection.findOne({ id: categoryId });
        if (!categoryToUpdate) {
            return res.status(404).json({ success: false, message: 'Parent category not found.' });
        }

        // 3. Check for duplicate subcategory NAME within the parent category
        // This prevents adding two subcategories with the exact same name under one parent.
        if (categoryToUpdate.subcategories && categoryToUpdate.subcategories.some(sub => sub.name === trimmedSubcategoryName)) {
            return res.status(409).json({ success: false, message: `Subcategory with name '${trimmedSubcategoryName}' already exists in this category.` });
        }

        // 4. Generate the new slug-like subcategory ID
        let baseSubcategorySlug = createSlug(trimmedSubcategoryName);
        let newSubcategoryId = baseSubcategorySlug;
        let counter = 0;

        // Check for ID uniqueness within the parent category's subcategories array
        while (categoryToUpdate.subcategories && categoryToUpdate.subcategories.some(sub => sub.id === newSubcategoryId)) {
            counter++;
            newSubcategoryId = `${baseSubcategorySlug}_${counter}`;
        }

        // 5. Construct the new subcategory object with the generated ID
        const newSubcategory = {
            id: newSubcategoryId, // Assign the backend-generated slug-like ID
            name: trimmedSubcategoryName,
            monthly_limit,
            color: color || '#CCCCCC', // Use provided color or a default grey
            icon: icon || 'question', // Use provided icon or a default 'question' icon
        };

        // 6. Add the new subcategory to the parent category's subcategories array in MongoDB
        const updateResult = await categoriesCollection.updateOne(
            { id: categoryId },
            { $push: { subcategories: newSubcategory } } // $push appends the new subcategory
        );

        // 7. Check if the update operation was acknowledged and actually modified a document
        if (updateResult.acknowledged && updateResult.modifiedCount > 0) {
            // Fetch the updated category document to return its current state to the frontend.
            const updatedCategory = await categoriesCollection.findOne({ id: categoryId });

            return res.status(201).json({
                success: true,
                data: normalizeMongoId(updatedCategory), // Use the helper to normalize the parent category's _id
                message: 'Subcategory added successfully.',
                newSubcategoryId: newSubcategoryId // Optionally return the generated ID of the new subcategory
            });
        } else {
            // This case might indicate the category was found but no modification occurred,
            // which could happen if an internal MongoDB error prevented the push.
            return res.status(400).json({ success: false, message: 'Subcategory not added, possibly due to an internal issue.' });
        }
    } catch (error) {
        console.error('Error adding subcategory:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};
// @desc    Update an existing subcategory within a category
// @route   PUT /api/utilities/categories/:categoryId/subcategories/:subId
// @access  Public
exports.updateSubcategory = async (req, res) => {
    try {
        const { categoryId, subId } = req.params;
        const updatedSubData = req.body;

        if (Object.keys(updatedSubData).length === 0) {
            return res.status(400).json({ success: false, message: 'No update data provided for subcategory.' });
        }

        const updateFields = {};
        for (const key in updatedSubData) {
            if (Object.hasOwnProperty.call(updatedSubData, key)) {
                updateFields[`subcategories.$.${key}`] = updatedSubData[key];
            }
        }

        const result = await categoriesCollection.updateOne(
            { id: categoryId, "subcategories.id": subId },
            { $set: updateFields },
            { returnDocument: 'after' }
        );

        if (result.modifiedCount > 0) {
            return res.status(200).json({ success: true, data: normalizeMongoId(result.value), message: 'Subcategory updated successfully.' });
        } else {
            return res.status(404).json({ success: false, message: 'Category or subcategory not found or no changes were made.' });
        }
    } catch (error) {
        console.error('Error updating subcategory:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Delete a subcategory from a category
// @route   DELETE /api/utilities/categories/:categoryId/subcategories/:subId
// @access  Public
exports.deleteSubcategory = async (req, res) => {
    try {
        const { categoryId, subId } = req.params;

        const result = await categoriesCollection.updateOne(
            { id: categoryId },
            { $pull: { subcategories: { id: subId } } },
            { returnDocument: 'after' }
        );
        if (result.modifiedCount > 0) {
            // This is important because findOneAndUpdate will return the document even if $pull didn't modify it (e.g., subId not found).
            return res.status(200).json({ success: true, data: normalizeMongoId(result.value), message: 'Subcategory deleted successfully.' });
        } else {
            return res.status(404).json({ success: false, message: 'Category not found.' });
        }
    } catch (error) {
        console.error('Error deleting subcategory:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

exports.deleteMainCategory = async (req, res) => {
    console.log('hit delete cat');
    try {
        const categoryId = req.params.id;
        const result = await categoriesCollection.deleteOne(
            { id: categoryId }
        );
        if (result.deletedCount > 0) {
            // This is important because findOneAndUpdate will return the document even if $pull didn't modify it (e.g., subId not found).
            return res.status(200).json({ success: true, data: normalizeMongoId(result.value), message: 'Subcategory deleted successfully.' });
        } else {
            return res.status(404).json({ success: false, message: 'Category not found.' });
        }
    } catch (error) {
        console.error('Error deleting subcategory:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Get all categories (kept for clarity, though getCategory with no ID handles this)
// @route   GET /api/utilities/categories (if you prefer a dedicated route for 'all')
// @access  Public
exports.getAllCategories = async (req, res) => {
    try {
        const categories = await categoriesCollection.find({}).toArray();

        res.status(200).json({
            success: true,
            message: `${categories.length} Categories found`,
            data: categories,
        });
    } catch (error) {
        console.error('Error fetching all categories:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};