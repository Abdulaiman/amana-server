const Product = require('../models/Product');

// @desc    Get All Products (Marketplace)
// @route   GET /api/products
// @access  Public
const getProducts = async (req, res) => {
    // Only show active products that are in stock
    const products = await Product.find({ 
        isActive: true, 
        countInStock: { $gt: 0 } 
    }).populate('vendor', 'businessName rating');
    res.json(products);
};

// @desc    Get Single Product
// @route   GET /api/products/:id
// @access  Public
const getProductById = async (req, res) => {
    const product = await Product.findById(req.params.id).populate('vendor', 'businessName rating');
    if (product) {
        res.json(product);
    } else {
        res.status(404);
        throw new Error('Product not found');
    }
};

// @desc    Create Product
// @route   POST /api/products
// @access  Private (Vendor)
const createProduct = async (req, res) => {
    const { name, price, description, category, countInStock, images } = req.body;

    const product = new Product({
        vendor: req.user._id,
        name,
        price,
        description,
        category,
        countInStock,
        images: images || [],
        isActive: true
    });

    const createdProduct = await product.save();
    res.status(201).json(createdProduct);
};

// @desc    Update Product
// @route   PUT /api/products/:id
// @access  Private (Vendor)
const updateProduct = async (req, res) => {
    const { name, price, description, category, countInStock, images, isActive } = req.body;
    const product = await Product.findById(req.params.id);

    if (product) {
        if (product.vendor.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
             res.status(401);
             throw new Error('Not authorized to update this product');
        }

        product.name = name || product.name;
        product.price = price || product.price;
        product.description = description || product.description;
        product.category = category || product.category;
        // Handle countInStock allowing 0
        product.countInStock = countInStock !== undefined ? countInStock : product.countInStock;
        product.images = images || product.images;
        // Handle isActive toggle
        product.isActive = isActive !== undefined ? isActive : product.isActive;

        const updatedProduct = await product.save();
        res.json(updatedProduct);
    } else {
        res.status(404);
        throw new Error('Product not found');
    }
};

// @desc    Delete Product
// @route   DELETE /api/products/:id
// @access  Private (Vendor)
const deleteProduct = async (req, res) => {
    const product = await Product.findById(req.params.id);

    if (product) {
        if (product.vendor.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
            res.status(401);
            throw new Error('Not authorized to delete this product');
       }
        
       await Product.deleteOne({ _id: product._id });
       res.json({ message: 'Product removed' });
    } else {
        res.status(404);
        throw new Error('Product not found');
    }
};

module.exports = { getProducts, getProductById, createProduct, updateProduct, deleteProduct };
