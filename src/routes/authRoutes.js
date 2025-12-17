const express = require('express');
const router = express.Router();
const { authUser, registerUser, registerVendor } = require('../controllers/authController');

router.post('/login', authUser);
router.post('/register', registerUser);
router.post('/register-vendor', registerVendor);

module.exports = router;
