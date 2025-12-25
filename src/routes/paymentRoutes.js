const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { initializePayment, verifyPayment, verifyPaymentAndRedirect } = require('../controllers/paymentController');

router.post('/initialize', protect, initializePayment);
router.get('/verify', verifyPayment);
router.get('/verify-redirect', verifyPaymentAndRedirect);

module.exports = router;
