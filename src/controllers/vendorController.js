const Vendor = require('../models/Vendor');
const Order = require('../models/Order');
const WithdrawalRequest = require('../models/WithdrawalRequest');

// @desc    Get Vendor Profile
// @route   GET /api/vendor/profile
// @access  Private (Vendor)
const getVendorProfile = async (req, res) => {
    const vendor = await Vendor.findById(req.user._id);

    if (vendor) {
        res.json({
            _id: vendor._id,
            businessName: vendor.businessName,
            email: vendor.email,
            phones: vendor.phones,
            address: vendor.address,
            description: vendor.description,
            ownerName: vendor.ownerName,
            ownerPhone: vendor.ownerPhone,
            profilePicUrl: vendor.profilePicUrl,
            walletBalance: vendor.walletBalance,
            bankDetails: vendor.bankDetails,
            isVerified: vendor.isVerified,
            isProfileComplete: vendor.isProfileComplete,
            verificationStatus: vendor.verificationStatus,
            cacNumber: vendor.cacNumber,
            cacDocumentUrl: vendor.cacDocumentUrl,
            rating: vendor.rating
        });
    } else {
        res.status(404);
        throw new Error('Vendor not found');
    }
};

// @desc    Complete Vendor Profile (KYC)
// @route   PUT /api/vendor/profile/complete
// @access  Private (Vendor)
const completeVendorProfile = async (req, res) => {
    const vendor = await Vendor.findById(req.user._id);

    if (!vendor) {
        return res.status(404).json({ message: 'Vendor not found' });
    }

    // Update KYC fields
    vendor.ownerName = req.body.ownerName || vendor.ownerName;
    vendor.ownerPhone = req.body.ownerPhone || vendor.ownerPhone;
    vendor.profilePicUrl = req.body.profilePicUrl || vendor.profilePicUrl;
    vendor.cacNumber = req.body.cacNumber || vendor.cacNumber;
    vendor.cacDocumentUrl = req.body.cacDocumentUrl || vendor.cacDocumentUrl;
    vendor.description = req.body.description || vendor.description;
    
    // Update Bank Details (required for payouts)
    if (req.body.bankDetails) {
        vendor.bankDetails = {
            bankName: req.body.bankDetails.bankName,
            accountNumber: req.body.bankDetails.accountNumber,
            accountName: req.body.bankDetails.accountName
        };
    }

    // Mark profile as complete
    vendor.isProfileComplete = true;
    vendor.verificationStatus = 'pending'; // Awaiting admin verification

    const updatedVendor = await vendor.save();

    res.json({
        message: 'Profile completed! Awaiting admin verification.',
        isProfileComplete: updatedVendor.isProfileComplete,
        verificationStatus: updatedVendor.verificationStatus
    });
};

// @desc    Update Vendor Profile (Phones, Bank, Etc)
// @route   PUT /api/vendor/profile
// @access  Private (Vendor)
const updateVendorProfile = async (req, res) => {
    const vendor = await Vendor.findById(req.user._id);

    if (vendor) {
        vendor.businessName = req.body.businessName || vendor.businessName;
        vendor.phones = req.body.phones || vendor.phones;
        vendor.address = req.body.address || vendor.address;
        vendor.description = req.body.description || vendor.description;
        
        // Update Bank Details
        if (req.body.bankDetails) {
            vendor.bankDetails = {
                bankName: req.body.bankDetails.bankName || vendor.bankDetails?.bankName,
                accountNumber: req.body.bankDetails.accountNumber || vendor.bankDetails?.accountNumber,
                accountName: req.body.bankDetails.accountName || vendor.bankDetails?.accountName
            };
        }

        const updatedVendor = await vendor.save();

        res.json({
            _id: updatedVendor._id,
            businessName: updatedVendor.businessName,
            phones: updatedVendor.phones,
            bankDetails: updatedVendor.bankDetails,
            message: 'Profile updated successfully'
        });
    } else {
        res.status(404);
        throw new Error('Vendor not found');
    }
};

// @desc    Request Payout
// @route   POST /api/vendor/payout/request
// @access  Private (Vendor)
const requestPayout = async (req, res) => {
    const { amount } = req.body;
    const vendor = await Vendor.findById(req.user._id);

    if (!vendor) {
        return res.status(404).json({ message: 'Vendor not found' });
    }


    // Check for existing pending request
    const existingPending = await WithdrawalRequest.findOne({ vendor: vendor._id, status: 'pending' });
    if (existingPending) {
        return res.status(400).json({ message: 'You already have a pending payout request. Please wait for it to be processed.' });
    }

    // Validation
    if (!amount || amount <= 0) {
        return res.status(400).json({ message: 'Invalid amount' });
    }

    if (amount > vendor.walletBalance) {
        return res.status(400).json({ message: 'Insufficient wallet balance' });
    }

    // Check if bank details exist
    if (!vendor.bankDetails?.accountNumber || !vendor.bankDetails?.bankName) {
        return res.status(400).json({ message: 'Please add bank details first' });
    }

    // Create withdrawal request with bank snapshot
    const withdrawalRequest = await WithdrawalRequest.create({
        vendor: vendor._id,
        amount,
        bankDetailsSnapshot: {
            bankName: vendor.bankDetails.bankName,
            accountNumber: vendor.bankDetails.accountNumber,
            accountName: vendor.bankDetails.accountName
        },
        status: 'pending'
    });

    res.status(201).json({
        message: 'Payout request submitted! Admin will process within 24-48 hours.',
        request: withdrawalRequest
    });
};

// @desc    Get My Payout Requests
// @route   GET /api/vendor/payout/requests
// @access  Private (Vendor)
const getMyPayoutRequests = async (req, res) => {
    const requests = await WithdrawalRequest.find({ vendor: req.user._id }).sort({ createdAt: -1 });
    res.json(requests);
};

// @desc    Get Vendor Dashboard Stats
// @route   GET /api/vendor/dashboard
// @access  Private (Vendor)
const getVendorDashboard = async (req, res) => {
    const orders = await Order.find({ vendor: req.user._id });
    const pendingPayouts = await WithdrawalRequest.find({ vendor: req.user._id, status: 'pending' });
    
    res.json({
        totalOrders: orders.length,
        walletBalance: req.user.walletBalance,
        pendingPayoutsCount: pendingPayouts.length,
        recentOrders: orders.slice(0, 5)
    });
};

// @desc    Get All Vendor's Products (includes out of stock)
// @route   GET /api/vendor/products
// @access  Private (Vendor)
const Product = require('../models/Product');
const getMyProducts = async (req, res) => {
    const products = await Product.find({ vendor: req.user._id }).sort({ createdAt: -1 });
    res.json(products);
};

module.exports = { 
    getVendorProfile, 
    completeVendorProfile,
    updateVendorProfile, 
    requestPayout,
    getMyPayoutRequests,
    getVendorDashboard,
    getMyProducts
};
