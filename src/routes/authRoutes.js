const express = require('express');
const router = express.Router();
const { authUser, registerUser, registerVendor, switchProfile } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

router.post('/login', authUser);
router.post('/register', registerUser);
router.post('/register-vendor', registerVendor);
router.post('/switch-role', protect, switchProfile);

module.exports = router;
