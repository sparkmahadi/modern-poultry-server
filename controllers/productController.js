const { ObjectId } = require('mongodb');
const { db } = require('../db'); // Assuming db.js exports your MongoDB database instance
const productsCollection = db.collection('products');
const categoriesCollection = db.collection('categories'); // To validate category/subcategory IDs
const inventoryCollection = db.collection('inventory'); // To validate category/subcategory IDs

// Helper function to normalize _id from MongoDB's ObjectId to a string ($oid)
const normalizeMongoId = (doc) => {
    if (doc && doc._id) {
        if (typeof doc._id.toHexString === 'function') {
            doc._id = { "$oid": doc._id.toHexString() };
        }
    }
    return doc;
};

// @desc    Get all products 
exports.getAllProducts = async (req, res) => {
    try {
        // Get all products
        const allProducts = await productsCollection.find({}).toArray();
        res.status(200).json({ success: true, message: `${allProducts.length} products found`, data: allProducts });

    } catch (error) {
        console.error('Error fetching all categories:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// @route   GET /api/utilities/products/:id (single)
// @route   GET /api/utilities/products (all)
// @access  Public
exports.getProduct = async (req, res) => {
    try {
        const { id } = req.params;

        if (id) {
            // Get a single product
            const product = await productsCollection.findOne({ id: id });
            if (!product) {
                return res.status(404).json({ success: false, message: 'Product not found' });
            }
            res.status(200).json({ success: true, data: normalizeMongoId(product) });
        }
    } catch (error) {
        console.error('Error fetching product(s):', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};
``
// @desc    Add a new product
// @route   POST /api/utilities/products
// @access  Public
exports.addProduct = async (req, res) => {
    console.log('hit add product');
    try {
        const { item_name, unit, price, date, category_id, notes } = req.body;

        // Basic validation
        if (!item_name || !date || !category_id) {
            return res.json({ success: false, message: 'Missing required product fields (item_name, date, category_id.' });
        }

        // Validate category and subcategory existence
        const category = await categoriesCollection.findOne({ id: category_id });
        if (!category) {
            return res.status(400).json({ success: false, message: `Category '${category_id}' not found.` });
        }

        // --- Start of Unique ID Generation Logic ---
        let newProductId = "item001"; // Default starting ID

        const lastProduct = await productsCollection.find({})
            .sort({ id: -1 }) // Sort by ID descending (e.g., item099, item098... item001)
            .limit(1)
            .toArray(); //

        if (lastProduct.length > 0) {
            const lastId = lastProduct[0].id; // e.g., "item009"
            const lastNumber = parseInt(lastId.replace('item', ''), 10); // Extract 9
            const nextNumber = lastNumber + 1; // Increment to 10
            // Pad with leading zeros (e.g., 10 becomes "010")
            newProductId = `item${String(nextNumber).padStart(3, '0')}`;
        }
        // --- End of Unique ID Generation Logic ---

        const newProduct = {
            id: newProductId, // Assign the newly generated sequential ID
            item_name: item_name.trim(),
            unit: unit.trim(),
            price: price,
            date: date,
            category_id: category_id,
            notes: notes || ''
        };

        const result = await productsCollection.insertOne(newProduct);

        if (result.acknowledged && result.insertedId) {
            const insertedProduct = await productsCollection.findOne({ _id: result.insertedId });
            return res.status(201).json({ success: true, data: normalizeMongoId(insertedProduct), message: `Product : ${insertedProduct.item_name} added successfully` });
        } else {
            return res.status(500).json({ success: false, message: "Failed to add product due to an unknown database issue." });
        }
    } catch (error) {
        console.error('Error adding new product:', error);
        if (error.code === 11000) {
            return res.status(409).json({ success: false, message: `A product with the generated ID already exists. Please try again (concurrency issue).` });
        }
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Update an existing product
// @route   PUT /api/utilities/products/:id
// @access  Public
exports.updateProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const { item_name, unit, quantity, price, date, category_id, notes } = req.body;

        const updateFields = {};
        if (item_name !== undefined) updateFields.item_name = item_name.trim();
        if (unit !== undefined) updateFields.unit = unit.trim();
        if (quantity !== undefined) updateFields.quantity = Number(quantity); // Ensure number
        if (price !== undefined) updateFields.price = Number(price); // Ensure number
        if (date !== undefined) updateFields.date = date;
        if (notes !== undefined) updateFields.notes = notes;

        // Recalculate total if quantity or price are updated
        if (quantity !== undefined || price !== undefined) {
            const existingProduct = await productsCollection.findOne({ id: id });
            if (existingProduct) {
                const newQuantity = quantity !== undefined ? Number(quantity) : existingProduct.quantity;
                const newPrice = price !== undefined ? Number(price) : existingProduct.price;
                updateFields.total = newQuantity * newPrice;
            }
        }

        // Handle category/subcategory updates if provided
        if (category_id !== undefined) {
            if (!category_id) { // If only subcategory_id is provided, and no category_id, this is an error
                return res.status(400).json({ success: false, message: "Cannot update subcategory without providing its parent category_id." });
            }
            const targetCategoryId = category_id || (await productsCollection.findOne({ id: id }))?.category_id;

            const category = await categoriesCollection.findOne({ id: targetCategoryId });
            if (!category) {
                return res.status(400).json({ success: false, message: `Category '${targetCategoryId}' not found.` });
            }
            updateFields.category_id = targetCategoryId;
        }

        if (Object.keys(updateFields).length === 0) {
            return res.status(400).json({ success: false, message: 'No valid fields provided for update.' });
        }

        const result = await productsCollection.updateOne(
            { id: id },
            { $set: updateFields },
            { returnDocument: 'after' }
        );

        if (result.modifiedCount > 0) {
            return res.status(200).json({ success: true, message: 'Product updated successfully.' });
        } else {
            return res.status(404).json({ success: false, message: 'Product not found or no changes were made.' });
        }
    } catch (error) {
        console.error('Error updating product:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// @desc    Delete a product
// @route   DELETE /api/utilities/products/:id
// @access  Public
exports.deleteProduct = async (req, res) => {
    try {
        const { id } = req.params;

        const result = await productsCollection.deleteOne({ id: id });

        if (result.deletedCount > 0) {
            return res.status(200).json({ success: true, message: 'Product deleted successfully.' });
        } else {
            return res.status(404).json({ success: false, message: 'Product not found.' });
        }
    } catch (error) {
        console.error('Error deleting product:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

exports.searchProducts = async (req, res) => {
    const searchTerm = req.query.q;
    console.log("search", searchTerm);
    try {

        if (!searchTerm || typeof searchTerm !== 'string' || searchTerm.trim() === '') {
            return res.status(400).json({ success: false, message: 'Search term (q) is required and must be a non-empty string.' });
        }

        // Use a case-insensitive regex search for flexibility
        // Example: Searching for 'rice' will match 'Miniket Rice', 'Basmati rice', etc.
        const query = {
            item_name: { $regex: new RegExp(searchTerm.trim(), 'i') }
        };

        // Fetch products from the master 'products' collection
        // Limit results to prevent returning too many and for performance
        const products = await productsCollection.find(query).limit(20).toArray();

        if (products.length === 0) {
            return res.status(200).json({ success: true, message: 'No products found matching your search.', data: [] });
        }

        res.status(200).json({ success: true, data: products });

    } catch (error) {
        console.error('Error searching products:', error);
        res.status(500).json({ success: false, message: 'Internal server error while searching products.' });
    }
};