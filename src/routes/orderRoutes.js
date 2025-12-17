const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { addOrderItems, getOrderById, updateOrderToReady, confirmGoodsReceived, updateOrderToCompleted, getMyOrders, cancelOrder } = require('../controllers/orderController');

router.route('/').post(protect, addOrderItems);
router.route('/myorders').get(protect, getMyOrders);
router.route('/:id').get(protect, getOrderById);
router.route('/:id/ready').put(protect, updateOrderToReady);
router.route('/:id/received').put(protect, confirmGoodsReceived); // New: Retailer confirms goods received
router.route('/:id/complete').put(protect, updateOrderToCompleted);
router.route('/:id/cancel').put(protect, cancelOrder);

module.exports = router;
