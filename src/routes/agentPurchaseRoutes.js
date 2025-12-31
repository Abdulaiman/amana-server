const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const {
    createAAP,
    linkRetailer,
    retailerConfirm,
    declineAAP,
    adminApprove,
    markDelivered,
    confirmReceipt,
    getAAPById,
    getAgentQueue,
    getRetailerAAPs,
    getAdminDashboard,
    getExpiredAAPs,
    searchRetailers,
    findRetailerByPhone,
    proxyConfirmAAP,
    proxyDeliverAAP
} = require('../controllers/agentPurchaseController');

// Agent Routes
router.post('/', protect, createAAP);
router.put('/:id/link-retailer', protect, linkRetailer);
router.get('/agent/queue', protect, getAgentQueue);
router.put('/:id/deliver', protect, markDelivered);
router.get('/search-retailers', protect, searchRetailers);
router.get('/search-retailers', protect, searchRetailers);
router.get('/find-retailer', protect, findRetailerByPhone);

// Proxy Routes
router.put('/:id/proxy-confirm', protect, proxyConfirmAAP);
router.put('/:id/proxy-deliver', protect, proxyDeliverAAP);

// Retailer Routes
router.put('/:id/confirm', protect, retailerConfirm);
router.put('/:id/receive', protect, confirmReceipt);
router.get('/retailer/mine', protect, getRetailerAAPs);

// Shared Routes
router.put('/:id/decline', protect, declineAAP);
router.get('/:id', protect, getAAPById);

// Admin Routes
router.put('/:id/approve', protect, admin, adminApprove);
router.get('/admin/dashboard', protect, admin, getAdminDashboard);
router.get('/admin/expired', protect, admin, getExpiredAAPs);

module.exports = router;
