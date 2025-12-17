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
        const updated = await vendor.save();
        res.json(updated);
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
    const pendingVendorVerifications = await Vendor.countDocuments({ isProfileComplete: true, verificationStatus: 'pending' });
    
    res.json({
        totalVendors,
        totalUsers,
        totalOrders: orders,
        pendingPayouts,
        pendingVendorVerifications
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

// @desc    Reject Vendor Verification
// @route   PUT /api/admin/vendor/:id/reject
// @access  Private (Admin)
const rejectVendor = async (req, res) => {
    const vendor = await Vendor.findById(req.params.id);

    if (vendor) {
        vendor.verificationStatus = 'rejected';
        vendor.isVerified = false;
        const updated = await vendor.save();
        res.json(updated);
    } else {
        res.status(404);
        throw new Error('Vendor not found');
    }
};

module.exports = { 
    getWithdrawalRequests, 
    confirmPayout, 
    verifyVendor, 
    rejectVendor,
    getAdminAnalytics,
    getAllVendors,
    getAllRetailers
};
