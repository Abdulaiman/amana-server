const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const { getAllTransactions, getVendorTransactions } = require('../controllers/transactionController');

// Admin Route
router.get('/admin', protect, admin, getAllTransactions);

// Vendor Route (Protected by 'protect' & internal vendor check in controller or middleware)
// Assuming 'protect' populates req.user. If user is vendor, getAllTransactions handles it? 
// No, I made separate functions.
router.get('/vendor', protect, getVendorTransactions);

module.exports = router;
