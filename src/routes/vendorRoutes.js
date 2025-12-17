const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { 
    getVendorProfile, 
    completeVendorProfile,
    updateVendorProfile, 
    requestPayout,
    getMyPayoutRequests,
    getVendorDashboard,
    getMyProducts
} = require('../controllers/vendorController');

// Profile
router.get('/profile', protect, getVendorProfile);
router.put('/profile', protect, updateVendorProfile);
router.put('/profile/complete', protect, completeVendorProfile);

// Dashboard
router.get('/dashboard', protect, getVendorDashboard);

// Products (Vendor's own products)
router.get('/products', protect, getMyProducts);

// Payout
router.post('/payout/request', protect, requestPayout);
router.get('/payout/requests', protect, getMyPayoutRequests);

module.exports = router;
