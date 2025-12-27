const Vendor = require('../models/Vendor');
const Order = require('../models/Order');
const Product = require('../models/Product');
const WithdrawalRequest = require('../models/WithdrawalRequest');

// @desc    Get Vendor Profile
// @route   GET /api/vendor/profile
// @access  Private (Vendor)
const getVendorProfile = async (req, res) => {
    const vendor = await Vendor.findById(req.user._id);

    if (vendor) {
        const [totalProducts, totalOrders, orders] = await Promise.all([
            Product.countDocuments({ vendor: req.user._id }),
            Order.countDocuments({ vendor: req.user._id }),
            Order.find({ vendor: req.user._id, status: { $in: ['vendor_settled', 'repaid', 'goods_received', 'completed'] } })
        ]);

        const totalEarnings = orders.reduce((sum, order) => sum + (order.itemsPrice || 0), 0);

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
            rejectionReason: vendor.rejectionReason,
            cacNumber: vendor.cacNumber,
            cacDocumentUrl: vendor.cacDocumentUrl,
            rating: vendor.rating,
            totalProducts,
            totalOrders,
            totalEarnings,
            isActive: vendor.isActive,
            isBanned: vendor.isBanned
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

    // Mark profile form as complete, but VERIFICATION is pending
    vendor.isProfileComplete = true; 
    vendor.verificationStatus = 'pending'; // Awaiting admin verification
    vendor.rejectionReason = undefined; // Clear previous rejection if any

    const updatedVendor = await vendor.save();

    res.json({
        message: 'KYC Details submitted! Awaiting admin verification.',
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
        vendor.profilePicUrl = req.body.profilePicUrl || vendor.profilePicUrl;
        
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
            profilePicUrl: updatedVendor.profilePicUrl,
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
    const [vendor, orders, pendingPayouts, totalProducts] = await Promise.all([
        Vendor.findById(req.user._id),
        Order.find({ vendor: req.user._id }).sort({ createdAt: -1 }),
        WithdrawalRequest.find({ vendor: req.user._id, status: 'pending' }),
        Product.countDocuments({ vendor: req.user._id })
    ]);

    if (!vendor) {
        return res.status(404).json({ message: 'Vendor not found' });
    }
    
    // Calculate earnings from non-cancelled/non-pending orders
    const successOrders = orders.filter(o => ['repaid', 'goods_received', 'vendor_settled', 'completed'].includes(o.status));
    const totalEarnings = successOrders.reduce((sum, o) => sum + (o.itemsPrice || 0), 0);

    res.json({
        totalOrders: orders.length,
        walletBalance: vendor.walletBalance,
        availableBalance: vendor.walletBalance,
        totalEarnings,
        totalProducts,
        pendingPayoutsCount: pendingPayouts.length,
        recentOrders: orders.slice(0, 5),
        isProfileComplete: vendor.isProfileComplete,
        verificationStatus: vendor.verificationStatus,
        rejectionReason: vendor.rejectionReason,
        profilePicUrl: vendor.profilePicUrl,
        bankDetails: vendor.bankDetails,
        isActive: vendor.isActive,
        isBanned: vendor.isBanned
    });
};

// @desc    Get All Vendor's Products (includes out of stock)
// @route   GET /api/vendor/products
// @access  Private (Vendor)
const getMyProducts = async (req, res) => {
    const products = await Product.find({ vendor: req.user._id }).sort({ createdAt: -1 });
    res.json(products);
};

// @desc    Get Vendor Stats (Daily Sales for last 7 days)
// @route   GET /api/vendor/stats
// @access  Private (Vendor)
const getVendorStats = async (req, res) => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const stats = await Order.aggregate([
        {
            $match: {
                vendor: req.user._id,
                status: { $in: ['vendor_settled', 'repaid', 'goods_received', 'completed'] },
                createdAt: { $gte: sevenDaysAgo }
            }
        },
        {
            $group: {
                _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                totalSales: { $sum: "$itemsPrice" }
            }
        },
        { $sort: { "_id": 1 } }
    ]);

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const formattedStats = [];
    
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const dayIndex = date.getDay();
        const dayName = days[dayIndex];
        
        const dayStat = stats.find(s => s._id === dateStr);
        formattedStats.push({
            label: dayName,
            value: dayStat ? dayStat.totalSales : 0
        });
    }

    res.json(formattedStats);
};

module.exports = { 
    getVendorProfile, 
    completeVendorProfile,
    updateVendorProfile, 
    requestPayout,
    getMyPayoutRequests,
    getVendorDashboard,
    getMyProducts,
    getVendorStats
};
