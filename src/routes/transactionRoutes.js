const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const { getAllTransactions, getVendorTransactions, getRetailerTransactions } = require('../controllers/transactionController');

// Admin Route
router.get('/admin', protect, admin, getAllTransactions);

// Vendor Route
router.get('/vendor', protect, getVendorTransactions);

// Retailer Route
router.get('/retailer', protect, getRetailerTransactions);

module.exports = router;
