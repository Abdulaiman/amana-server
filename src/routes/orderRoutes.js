const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { 
    addOrderItems, 
    getOrderById, 
    updateOrderToReady, 
    settleVendorByAgent, // Added
    confirmGoodsReceived, 
    updateOrderToCompleted, 
    getMyOrders, 
    cancelOrder 
} = require('../controllers/orderController');

router.route('/').post(protect, addOrderItems);
router.route('/myorders').get(protect, getMyOrders);
router.route('/:id').get(protect, getOrderById);
router.route('/:id/ready').put(protect, updateOrderToReady);
router.route('/:id/settle-vendor').put(protect, settleVendorByAgent); // Phase 1: Agent Settle
router.route('/:id/received').put(protect, confirmGoodsReceived); // Phase 2: Retailer Confirm
router.route('/:id/complete').put(protect, updateOrderToCompleted);
router.route('/:id/cancel').put(protect, cancelOrder);

module.exports = router;
