const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { initializePayment, verifyPayment } = require('../controllers/paymentController');

router.post('/initialize', protect, initializePayment);
router.get('/verify', verifyPayment);

module.exports = router;
