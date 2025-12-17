const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { submitOnboarding, getRetailerProfile, completeProfile } = require('../controllers/retailerController');

router.post('/onboarding', protect, submitOnboarding);
router.put('/profile/complete', protect, completeProfile); // New KYC Endpoint
router.get('/profile', protect, getRetailerProfile);

module.exports = router;
