const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { getProducts, getProductById, createProduct, updateProduct, deleteProduct, getCategories } = require('../controllers/productController');

router.route('/').get(getProducts).post(protect, createProduct);
router.get('/categories', getCategories);
router.route('/:id')
    .get(getProductById)
    .put(protect, updateProduct)
    .delete(protect, deleteProduct);

module.exports = router;
