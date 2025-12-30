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

// @desc    Update Basic Profile (Non-sensitive)
// @route   PUT /api/retailer/profile
// @access  Private
const updateProfile = async (req, res) => {
    try {
        const { name, phone, address, businessInfo, profilePicUrl } = req.body;
        const user = await User.findById(req.user._id);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Only update non-sensitive fields
        if (name) user.name = name;
        if (phone) user.phone = phone;
        if (address) user.address = address;
        if (profilePicUrl) {
            user.kyc.profilePicUrl = profilePicUrl;
        }
        
        if (businessInfo) {
            user.businessInfo = {
                ...user.businessInfo,
                businessName: businessInfo.businessName || user.businessInfo?.businessName,
                businessType: businessInfo.businessType || user.businessInfo?.businessType,
                description: businessInfo.description || user.businessInfo?.description
            };
        }

        await user.save();

        res.json({
            message: 'Profile updated successfully',
            user: {
                name: user.name,
                phone: user.phone,
                address: user.address,
                businessInfo: user.businessInfo,
                profilePicUrl: user.kyc?.profilePicUrl
            }
        });
    } catch (error) {
        console.error('Update Profile Error:', error);
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
            availableCredit: user.creditLimit - user.usedCredit,
            amanaScore: user.amanaScore,
            tier: user.tier || 'Bronze',
            markupTier: markupPercentage,
            
            kyc: user.kyc,
            hasTakenTest: user.hasTakenTest,
            isAgent: user.isAgent,
            isActive: user.isActive,
            isBanned: user.isBanned
        });
    } else {
        res.status(404);
        throw new Error('User not found');
    }
};

// @desc    Get Retailer Stats (Daily Purchases for last 7 days)
// @route   GET /api/retailer/stats
// @access  Private
const getRetailerStats = async (req, res) => {
    try {
        const Order = require('../models/Order');
        const AgentPurchase = require('../models/AgentPurchase');
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        // Fetch Order Stats
        const orderStats = await Order.aggregate([
            {
                $match: {
                    retailer: req.user._id,
                    createdAt: { $gte: sevenDaysAgo }
                }
            },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                    totalSpent: { $sum: "$itemsPrice" }
                }
            }
        ]);

        // Fetch AAP Stats
        const aapStats = await AgentPurchase.aggregate([
            {
                $match: {
                    retailer: req.user._id,
                    createdAt: { $gte: sevenDaysAgo }
                }
            },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                    totalSpent: { $sum: "$purchasePrice" }
                }
            }
        ]);

        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const formattedStats = [];
        
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            const dayIndex = date.getDay();
            const dayName = days[dayIndex];
            
            const dayOrderStat = orderStats.find(s => s._id === dateStr);
            const dayAapStat = aapStats.find(s => s._id === dateStr);
            
            const totalOnDay = (dayOrderStat ? dayOrderStat.totalSpent : 0) + 
                               (dayAapStat ? dayAapStat.totalSpent : 0);

            formattedStats.push({
                label: dayName,
                value: totalOnDay
            });
        }

        res.json(formattedStats);
    } catch (error) {
        console.error('Stats Error:', error);
        res.status(500).json({ message: error.message });
    }
};

module.exports = { submitOnboarding, completeProfile, updateProfile, getRetailerProfile, getRetailerStats };
