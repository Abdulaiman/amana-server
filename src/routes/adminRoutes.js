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
    getAllRetailers,
    getAllAgents,
    toggleAgentStatus,
    searchRetailers,
    getUniversalSearch,
    getAdvancedFinancials,
    getUserFullProfile,
    manualLedgerEntry,
    toggleAccountStatus,

    getAuditLogs,
    getDebtors,
    sendBroadcast,
    confirmManualPayment
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
router.get('/retailers/search', protect, admin, searchRetailers);
router.get('/retailer/:id', protect, admin, getRetailerDetails);
router.put('/retailer/:id/verify', protect, admin, verifyRetailer);
router.put('/retailer/:id/reject', protect, admin, rejectRetailer);
router.put('/retailer/:id/agent', protect, admin, toggleAgentStatus);

// Agent Management
router.get('/agents', protect, admin, getAllAgents);

// Operations & Search (God Mode)
router.get('/search', protect, admin, getUniversalSearch);
router.get('/financials', protect, admin, getAdvancedFinancials);
router.get('/user/:id/full', protect, admin, getUserFullProfile);
router.post('/ledger', protect, admin, manualLedgerEntry);
router.put('/user/:id/status', protect, admin, toggleAccountStatus);
router.get('/audit-logs', protect, admin, getAuditLogs);
router.get('/debtors', protect, admin, getDebtors);
router.post('/broadcast', protect, admin, sendBroadcast);
router.post('/confirm-payment', protect, admin, confirmManualPayment);

// Analytics
router.get('/analytics', protect, admin, getAdminAnalytics);

module.exports = router;
