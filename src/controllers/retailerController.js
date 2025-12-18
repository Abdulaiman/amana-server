const User = require('../models/User');
const { 
    calculateInitialScore, 
    determineCreditLimit, 
    determineTier 
} = require('../utils/amanaEngine');

// @desc    Submit Psychometric Test Only (Step 1)
// @route   POST /api/retailer/onboarding
// @access  Private
const submitOnboarding = async (req, res) => {
    try {
        const { testScore, bankStatementUrl, nin } = req.body;
        
        if (!req.user || !req.user._id) throw new Error('User context missing');

        const user = await User.findById(req.user._id);
        if (!user) throw new Error('User not found');

        // Just save the quiz score. Limit comes after Profile Completion.
        user.hasTakenTest = true;
        user.testScore = Number(testScore);
        
        // Save bank statement if provided
        if (bankStatementUrl) {
            user.kyc.bankStatementUrl = bankStatementUrl;
        }

        // Save NIN if provided
        if (nin) {
            user.kyc.nin = nin;
        }
        
        await user.save();

        res.json({
            message: 'Trust Assessment saved. Please complete your profile to unlock credit.',
            nextStep: 'complete_profile'
        });

    } catch (error) {
        console.error('Onboarding Error:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Complete Profile & KYC (Step 2 - Unlocks Credit)
// @route   PUT /api/retailer/profile/complete
// @access  Private
const completeProfile = async (req, res) => {
    try {
        const { 
            businessName, businessType, yearsInBusiness, startingCapital, description, address,
            bvn, nin, idCardUrl, locationProofUrl, profilePicUrl, nextOfKin
        } = req.body;

        const user = await User.findById(req.user._id);

        // Gatekeeper: Check if sensitive data is locked
        if (user.sensitiveDataLocked) {
             // If locked, we reject changes to sensitive fields, but allow Business Info updates if needed?
             // User prompt: "sensitive data should not be edited... all necessary things should remain unchangable"
             // Implementation: If locked, reject the request if it tries to touch sensitive fields.
             // For simplicity in this endpoint (which is "Complete Profile"), we block the whole thing if already verified.
             return res.status(400).json({ message: 'Profile is verified and locked. Contact support for changes.' });
        }

        // 1. Save Business & Personal Info
        user.businessInfo = {
            businessName, businessType, yearsInBusiness, startingCapital, description
        };
        user.address = address;
        
        user.nextOfKin = nextOfKin; // Expecting object { name, phone... }

        // 2. Save Sensitive KYC (Locked)
        user.kyc = {
            ...user.kyc, // Preserve NIN from onboarding
            bvn: bvn || user.kyc.bvn,
            nin: nin || user.kyc.nin,
            idCardUrl,
            locationProofUrl,
            profilePicUrl,
            isKycSubmitted: true,
            isKycVerified: false 
        };
        
        user.verificationStatus = 'pending';
        user.sensitiveDataLocked = true; // LOCK IT NOW

        // 3. DO NOT RUN AMANA ENGINE YET
        // Score/Limit will be assigned by Admin upon approval.
        
        user.isProfileComplete = false; // Remains false until admin approves

        await user.save();

        res.json({
            message: 'Profile submitted! Awaiting admin verification of your documents.',
            verificationStatus: 'pending'
        });

    } catch (error) {
        console.error('Profile Completion Error:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get Retailer Profile
// @route   GET /api/retailer/profile
// @access  Private
const getRetailerProfile = async (req, res) => {
    const user = await User.findById(req.user._id);

    if (user) {
        // Calculate Markup on the fly to ensure consistency with Engine
        const markupPercentage = require('../utils/amanaEngine').determineMarkup(user.amanaScore);

        res.json({
            _id: user._id,
            name: user.name,
            email: user.email,
            phone: user.phone, // Added
            address: user.address, // Added
            isProfileComplete: user.isProfileComplete,
            verificationStatus: user.verificationStatus,
            rejectionReason: user.rejectionReason,
            businessInfo: user.businessInfo,
            sensitiveDataLocked: user.sensitiveDataLocked,
            
            // Financials
            walletBalance: user.walletBalance,
            creditLimit: user.creditLimit,
            usedCredit: user.usedCredit,
            amanaScore: user.amanaScore,
            tier: user.tier || 'Bronze',
            markupTier: markupPercentage,
            
            kyc: user.kyc,
            hasTakenTest: user.hasTakenTest
        });
    } else {
        res.status(404);
        throw new Error('User not found');
    }
};

module.exports = { submitOnboarding, completeProfile, getRetailerProfile };
