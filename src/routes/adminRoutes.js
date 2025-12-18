const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const { 
    getWithdrawalRequests, 
    confirmPayout, 
    verifyVendor, 
    rejectVendor,
    verifyRetailer,
    rejectRetailer,
    getRetailerDetails,
    getVendorDetails,
    getAdminAnalytics,
    getAllVendors,
    getAllRetailers
} = require('../controllers/adminController');

// Withdrawals / Payouts
router.get('/withdrawals', protect, admin, getWithdrawalRequests);
router.put('/withdrawals/:id/confirm', protect, admin, confirmPayout);

// Vendor Management
router.get('/vendors', protect, admin, getAllVendors);
router.get('/vendor/:id', protect, admin, getVendorDetails);
router.put('/vendor/:id/verify', protect, admin, verifyVendor);
router.put('/vendor/:id/reject', protect, admin, rejectVendor);

// Retailer Management
router.get('/retailers', protect, admin, getAllRetailers);
router.get('/retailer/:id', protect, admin, getRetailerDetails);
router.put('/retailer/:id/verify', protect, admin, verifyRetailer);
router.put('/retailer/:id/reject', protect, admin, rejectRetailer);

// Analytics
router.get('/analytics', protect, admin, getAdminAnalytics);

module.exports = router;
