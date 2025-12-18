const User = require('../models/User');
const Vendor = require('../models/Vendor');
const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const WithdrawalRequest = require('../models/WithdrawalRequest');

// @desc    Get All Withdrawal Requests
// @route   GET /api/admin/withdrawals
// @access  Private (Admin)
const getWithdrawalRequests = async (req, res) => {
    const requests = await WithdrawalRequest.find({}).populate('vendor', 'businessName email walletBalance');
    res.json(requests);
};

// @desc    Confirm Payout (Manual Transfer Done)
// @route   PUT /api/admin/withdrawals/:id/confirm
// @access  Private (Admin)
const confirmPayout = async (req, res) => {
    const request = await WithdrawalRequest.findById(req.params.id);

    if (request) {
        if (request.status === 'approved') {
            res.status(400);
            throw new Error('Request already approved');
        }

        const vendor = await Vendor.findById(request.vendor);
        
        // Deduct from Logic Wallet (already allocated visually but now confirmed transferred)
        // Wait, earlier design: "vendor request withdrawal -> admin confirm".
        // Usually funds are deducted when request is MADE to prevent double spend.
        // Let's assume deducted on request creation? No, let's keep it simple:
        // Current balance check -> Deduct on APPROVAL.
        
        if (vendor.walletBalance < request.amount) {
            res.status(400);
             request.status = 'rejected';
             request.adminNote = 'Insufficient wallet balance during processing';
             await request.save();
             throw new Error('Insufficient vendor funds');
        }

        vendor.walletBalance -= request.amount;
        await vendor.save();

        request.status = 'approved';
        request.paidAt = Date.now();
        request.approvedBy = req.user._id;
        await request.save();

        // Log Transaction
        await Transaction.create({
            vendor: vendor._id,
            type: 'vendor_payout',
            amount: request.amount,
            description: `Manual Payout Reference: ${request._id}`,
            status: 'success'
        });

        res.json(request);
    } else {
        res.status(404);
        throw new Error('Request not found');
    }
};

// @desc    Verify Vendor
// @route   PUT /api/admin/vendor/:id/verify
// @access  Private (Admin)
const verifyVendor = async (req, res) => {
    const vendor = await Vendor.findById(req.params.id);

    if (vendor) {
        vendor.isVerified = true;
        vendor.verificationStatus = 'verified';
        vendor.isProfileComplete = true; // Confirmation
        vendor.rejectionReason = undefined; 
        
        const updated = await vendor.save();
        res.json(updated);
    } else {
        res.status(404);
        throw new Error('Vendor not found');
    }
};

// @desc    Reject Vendor Verification
// @route   PUT /api/admin/vendor/:id/reject
// @access  Private (Admin)
const rejectVendor = async (req, res) => {
    const { reason } = req.body;
    const vendor = await Vendor.findById(req.params.id);

    if (vendor) {
        vendor.verificationStatus = 'rejected';
        vendor.isVerified = false;
        vendor.rejectionReason = reason || 'Documents do not meet requirements.';
        
        const updated = await vendor.save();
        res.json(updated);
    } else {
        res.status(404);
        throw new Error('Vendor not found');
    }
};

// @desc    Verify Retailer
// @route   PUT /api/admin/retailer/:id/verify
// @access  Private (Admin)
const { calculateInitialScore, determineCreditLimit, determineTier } = require('../utils/amanaEngine');

const verifyRetailer = async (req, res) => {
    const user = await User.findById(req.params.id);

    if (user && user.role === 'retailer') {
        // 1. RUN AMANA ENGINE UPON APPROVAL
        const finalScore = calculateInitialScore(user.testScore, {
            yearsInBusiness: user.businessInfo?.yearsInBusiness,
            hasPhysicalLocation: !!user.kyc?.locationProofUrl,
            startingCapital: user.businessInfo?.startingCapital
        });

        const limit = determineCreditLimit(finalScore);
        const tier = determineTier(finalScore);

        // 2. Update Status & Financials
        user.verificationStatus = 'approved';
        user.isKycVerified = true;
        user.isProfileComplete = true;
        user.rejectionReason = undefined;
        
        user.amanaScore = finalScore;
        user.creditLimit = limit;
        user.tier = tier;

        const updated = await user.save();
        res.json(updated);
    } else {
        res.status(404);
        throw new Error('Retailer not found');
    }
};

// @desc    Reject Retailer
// @route   PUT /api/admin/retailer/:id/reject
// @access  Private (Admin)
const rejectRetailer = async (req, res) => {
    const { reason } = req.body;
    const user = await User.findById(req.params.id);

    if (user && user.role === 'retailer') {
        user.verificationStatus = 'rejected';
        user.isProfileComplete = false; // Kick back to profile steps
        user.sensitiveDataLocked = false; // Allow re-upload
        user.rejectionReason = reason || 'Information provided is incomplete or unclear.';
        
        const updated = await user.save();
        res.json(updated);
    } else {
        res.status(404);
        throw new Error('Retailer not found');
    }
};

// @desc    Get Detailed Retailer Info
// @route   GET /api/admin/retailer/:id
// @access  Private (Admin)
const getRetailerDetails = async (req, res) => {
    const retailer = await User.findById(req.params.id).select('-password');
    if (retailer) {
        res.json(retailer);
    } else {
        res.status(404);
        throw new Error('Retailer not found');
    }
};

// @desc    Get Detailed Vendor Info
// @route   GET /api/admin/vendor/:id
// @access  Private (Admin)
const getVendorDetails = async (req, res) => {
    const vendor = await Vendor.findById(req.params.id).select('-password');
    if (vendor) {
        res.json(vendor);
    } else {
        res.status(404);
        throw new Error('Vendor not found');
    }
};

// @desc    Get Global Analytics
// @route   GET /api/admin/analytics
// @access  Private (Admin)
const getAdminAnalytics = async (req, res) => {
    const totalVendors = await Vendor.countDocuments();
    const totalUsers = await User.countDocuments();
    const orders = await Order.countDocuments();
    const pendingPayouts = await WithdrawalRequest.countDocuments({ status: 'pending' });
    
    // Updated visibility of pending verifications
    const pendingVendorVerifications = await Vendor.countDocuments({ isProfileComplete: true, verificationStatus: 'pending' });
    const pendingRetailerVerifications = await User.countDocuments({ role: 'retailer', verificationStatus: 'pending' });
    
    res.json({
        totalVendors,
        totalUsers,
        totalOrders: orders,
        pendingPayouts,
        pendingVendorVerifications,
        pendingRetailerVerifications
    });
};

// @desc    Get All Vendors
// @route   GET /api/admin/vendors
// @access  Private (Admin)
const getAllVendors = async (req, res) => {
    const vendors = await Vendor.find({}).select('-password').sort({ createdAt: -1 });
    res.json(vendors);
};

// @desc    Get All Retailers
// @route   GET /api/admin/retailers
// @access  Private (Admin)
const getAllRetailers = async (req, res) => {
    const retailers = await User.find({ role: 'retailer' }).select('-password').sort({ createdAt: -1 });
    res.json(retailers);
};

// @desc    Get All Agents
// @route   GET /api/admin/agents
// @access  Private (Admin)
const getAllAgents = async (req, res) => {
    const agents = await User.find({ isAgent: true }).select('-password').sort({ createdAt: -1 });
    res.json(agents);
};

// @desc    Toggle Agent Status for a Retailer
// @route   PUT /api/admin/retailer/:id/agent
// @access  Private (Admin)
const toggleAgentStatus = async (req, res) => {
    const user = await User.findById(req.params.id);

    if (user && user.role === 'retailer') {
        user.isAgent = !user.isAgent;
        const updated = await user.save();
        res.json({ message: `Agent status updated for ${user.name}`, isAgent: updated.isAgent });
    } else {
        res.status(404);
        throw new Error('Retailer not found');
    }
};

// @desc    Search for Retailers (to assign as agents)
// @route   GET /api/admin/retailers/search
// @access  Private (Admin)
const searchRetailers = async (req, res) => {
    const { query } = req.query; // can be phone or NIN
    if (!query) return res.status(400).json({ message: 'Search query required' });

    const retailers = await User.find({
        role: 'retailer',
        $or: [
            { phone: query },
            { "kyc.nin": query }
        ]
    }).select('-password');

    res.json(retailers);
};

module.exports = { 
    getWithdrawalRequests, 
    confirmPayout, 
    verifyVendor, 
    rejectVendor,
    verifyRetailer,
    rejectRetailer,
    getRetailerDetails,
    getVendorDetails,
    getAdminAnalytics,
    getAllVendors,
    getAllRetailers,
    getAllAgents,
    toggleAgentStatus,
    searchRetailers
};
