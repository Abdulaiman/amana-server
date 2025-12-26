const express = require('express');
const router = express.Router();
const { authUser, registerUser, registerVendor, switchProfile, forgotPassword, resetPassword } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

router.post('/login', authUser);
router.post('/register', registerUser);
router.post('/register-vendor', registerVendor);
router.post('/switch-role', protect, switchProfile);
router.post('/forgot-password', forgotPassword);
router.put('/reset-password/:resettoken', resetPassword);

module.exports = router;
