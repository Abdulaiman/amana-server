const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const { 
    getWithdrawalRequests, 
    confirmPayout, 
    verifyVendor, 
    rejectVendor,
    getAdminAnalytics,
    getAllVendors,
    getAllRetailers
} = require('../controllers/adminController');

// Withdrawals / Payouts
router.get('/withdrawals', protect, admin, getWithdrawalRequests);
router.put('/withdrawals/:id/confirm', protect, admin, confirmPayout);

// Vendor Management
router.get('/vendors', protect, admin, getAllVendors);
router.put('/vendor/:id/verify', protect, admin, verifyVendor);
router.put('/vendor/:id/reject', protect, admin, rejectVendor);

// Retailer Management
router.get('/retailers', protect, admin, getAllRetailers);

// Analytics
router.get('/analytics', protect, admin, getAdminAnalytics);

module.exports = router;
