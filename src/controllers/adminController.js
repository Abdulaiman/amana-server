const User = require('../models/User');
const Vendor = require('../models/Vendor');
const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const AuditLog = require('../models/AuditLog');
const AgentPurchase = require('../models/AgentPurchase');
const sendEmail = require('../utils/emailService');

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
    const totalAAP = await AgentPurchase.countDocuments();
    const pendingPayouts = await WithdrawalRequest.countDocuments({ status: 'pending' });
    
    // Updated visibility of pending verifications
    const pendingVendorVerifications = await Vendor.countDocuments({ isProfileComplete: true, verificationStatus: 'pending' });
    const pendingRetailerVerifications = await User.countDocuments({ role: 'retailer', verificationStatus: 'pending' });
    const pendingAAPCount = await AgentPurchase.countDocuments({ status: 'pending_admin_approval' });
    
    res.json({
        totalVendors,
        totalUsers,
        totalOrders: orders,
        totalAAP,
        pendingPayouts,
        pendingVendorVerifications,
        pendingRetailerVerifications,
        pendingAAPCount
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

// --- NEW GOD MODE FEATURES ---

// @desc    Universal Search (Users, Vendors)
// @route   GET /api/admin/search
const getUniversalSearch = async (req, res) => {
    const { query } = req.query;
    if (!query) return res.status(400).json({ message: 'Query required' });

    const regex = new RegExp(query, 'i');

    const users = await User.find({
        $or: [{ name: regex }, { email: regex }, { phone: regex }]
    }).select('name email phone role verificationStatus isActive');

    const vendors = await Vendor.find({
        $or: [{ businessName: regex }, { email: regex }, { 'phones': regex }]
    }).select('businessName email verificationStatus isActive');

    res.json({ users, vendors });
};

// @desc    Get Advanced Financial Analytics
// @route   GET /api/admin/financials
// @desc    Get Advanced Financial Analytics
// @route   GET /api/admin/financials
const getAdvancedFinancials = async (req, res) => {
    // 1. Total Volume (Items Price + Markup) of ALL DELIVERED transactions (Completed + Active Debt)
    const orderVolume = await Order.aggregate([
        { $match: { status: { $in: ['completed', 'repaid', 'goods_received', 'vendor_settled'] } } },
        { $group: {
            _id: null,
            totalVolume: { $sum: '$totalRepaymentAmount' },
            principal: { $sum: '$itemsPrice' },
            revenue: { $sum: '$markupAmount' }
        }}
    ]);

    const aapVolume = await AgentPurchase.aggregate([
        { $match: { status: { $in: ['completed', 'received', 'delivered', 'fund_disbursed'] } } },
        { $group: {
            _id: null,
            totalVolume: { $sum: '$totalRetailerCost' },
            principal: { $sum: '$purchasePrice' },
            revenue: { $sum: '$markupAmount' }
        }}
    ]);

    const ord = orderVolume[0] || { totalVolume: 0, principal: 0, revenue: 0 };
    const aap = aapVolume[0] || { totalVolume: 0, principal: 0, revenue: 0 };

    const totalVolume = ord.totalVolume + aap.totalVolume;
    const totalPrincipal = ord.principal + aap.principal;
    const totalRevenue = ord.revenue + aap.revenue;

    // 2. Active Debt (Pending Repayment)
    const orderLiability = await Order.aggregate([
        { $match: { status: { $in: ['goods_received', 'vendor_settled'] }, isPaid: false } },
        { $group: { _id: null, totalDebt: { $sum: '$totalRepaymentAmount' } } }
    ]);

    const aapLiability = await AgentPurchase.aggregate([
        { $match: { status: { $in: ['received', 'delivered'] }, isPaid: false } }, // fund_disbursed is exposure but not yet "debt" in retailer's view usually? No, it's out of amana's pocket so it IS liability.
        { $group: { _id: null, totalDebt: { $sum: '$totalRetailerCost' } } }
    ]);

    const totalActiveDebt = (orderLiability[0]?.totalDebt || 0) + (aapLiability[0]?.totalDebt || 0);

    // 3. Total Payouts (Real Cash Out - Approved Withdrawals + AAP Disbursements)
    const withdrawalStats = await WithdrawalRequest.aggregate([
        { $match: { status: 'approved' } },
        { $group: { _id: null, totalPaid: { $sum: '$amount' } } }
    ]);

    const aapDisbursementStats = await AgentPurchase.aggregate([
        { $match: { status: { $in: ['fund_disbursed', 'delivered', 'received', 'completed'] } } },
        { $group: { _id: null, totalDisbursed: { $sum: '$purchasePrice' } } }
    ]);

    const totalPayouts = (withdrawalStats[0]?.totalPaid || 0) + (aapDisbursementStats[0]?.totalDisbursed || 0);

    // 4. Vendor Wallet Liability (Money held by system for Vendors)
    const vendorLiability = await Vendor.aggregate([
        { $group: { _id: null, totalWallet: { $sum: '$walletBalance' } } }
    ]);

    // 5. Retailer Credit Capacity
    const retailerCredit = await User.aggregate([
        { $match: { role: 'retailer' } },
        { $group: { 
            _id: null, 
            totalCreditLimit: { $sum: '$creditLimit' },
            totalUsedCredit: { $sum: '$usedCredit' }
        }}
    ]);

    // 6. Overdue Debt (Past Due Date)
    const now = new Date();
    const orderOverdue = await Order.aggregate([
        { $match: { 
            status: { $in: ['goods_received', 'vendor_settled', 'defaulted'] }, 
            isPaid: false,
            dueDate: { $lt: now }
        }},
        { $group: { _id: null, totalOverdue: { $sum: '$totalRepaymentAmount' } } }
    ]);

    const aapOverdue = await AgentPurchase.aggregate([
        { $match: { 
            status: 'received', // AAP only has dueDate once received? No, check model. receivedAt starts the clock.
            isPaid: false,
            dueDate: { $lt: now }
        }},
        { $group: { _id: null, totalOverdue: { $sum: '$totalRetailerCost' } } }
    ]);

    const totalOverdue = (orderOverdue[0]?.totalOverdue || 0) + (aapOverdue[0]?.totalOverdue || 0);

    // 7. Manual Adjustments
    const adjustments = await AuditLog.aggregate([
        { $match: { action: { $in: ['MANUAL_CREDIT', 'MANUAL_DEBIT'] } } },
        { $group: { 
            _id: '$action', 
            total: { $sum: '$details.amount' } 
        }}
    ]);

    const manualCredits = adjustments.find(a => a._id === 'MANUAL_CREDIT')?.total || 0;
    const manualDebits = adjustments.find(a => a._id === 'MANUAL_DEBIT')?.total || 0;
    const netManual = manualCredits - manualDebits;

    res.json({
        volume: totalVolume,
        principal: totalPrincipal,
        profit: totalRevenue,
        activeDebt: totalActiveDebt,
        overdueDebt: totalOverdue,
        totalPayouts: totalPayouts,
        pendingPayouts: vendorLiability[0]?.totalWallet || 0,
        totalCreditLimit: retailerCredit[0]?.totalCreditLimit || 0,
        totalUsedCredit: retailerCredit[0]?.totalUsedCredit || 0,
        availableCredit: (retailerCredit[0]?.totalCreditLimit || 0) - (retailerCredit[0]?.totalUsedCredit || 0),
        manualAdjustments: netManual,
        systemHealth: {
            moneyInSystem: totalPrincipal + netManual, // Money sent to vendors OR disbursed for AAPs
            moneyLiability: totalPayouts + (vendorLiability[0]?.totalWallet || 0)
        }
    });
};

// @desc    Get Detailed User/Vendor Profile (God View)
// @route   GET /api/admin/user/:id/full
const getUserFullProfile = async (req, res) => {
    let user = await User.findById(req.params.id).select('-password');
    let type = 'retailer';
    let orders = [];

    if (!user) {
        // Try Vendor
        const vendor = await Vendor.findById(req.params.id);
        if (vendor) {
            type = 'vendor';
            // Normalize Vendor to look like User for the frontend View
            user = {
                _id: vendor._id,
                name: vendor.businessName,
                email: vendor.email,
                phone: vendor.phones[0],
                role: 'vendor',
                isActive: vendor.isActive,
                isAgent: false,
                amanaScore: vendor.rating * 20, // Rough equivalent
                walletBalance: vendor.walletBalance,
                creditLimit: 0, // Vendors don't have credit limits usually
                usedCredit: 0,
                businessInfo: {
                    businessName: vendor.businessName,
                    address: vendor.address,
                    cacNumber: vendor.cacNumber
                },
                adminNotes: vendor.adminNotes,
                createdAt: vendor.createdAt
            };
            // For Vendors, show orders they SOLD
            orders = await Order.find({ vendor: vendor._id })
                .sort({ createdAt: -1 })
                .populate('retailer', 'name'); 
        }
    } else {
        // It is a Retailer
        orders = await Order.find({ retailer: user._id }).sort({ createdAt: -1 });
    }

    if (!user) {
        res.status(404);
        throw new Error('Identity not found (checked User and Vendor directories)');
    }

    // Admin Notes
    const notes = user.adminNotes || [];

    res.json({
        user,
        orders,
        notes,
        stats: {
            totalOrders: orders.length,
            completedOrders: orders.filter(o => o.status === 'completed' || o.status === 'repaid' || o.status === 'goods_received').length,
            totalSpent: orders.reduce((acc, o) => acc + (o.totalRepaymentAmount || 0), 0)
        }
    });
};

// @desc    Manual Ledger Entry
// @route   POST /api/admin/ledger
const manualLedgerEntry = async (req, res) => {
    const { userId, email, type, amount, reason, note } = req.body; // type: 'credit' or 'debit'

    let user;
    
    if (userId) {
        user = await User.findById(userId);
    } else if (email) {
        user = await User.findOne({ email });
    }

    if (!user) {
        res.status(404);
        throw new Error('User not found by ID or Email');
    }

    const previousBalance = user.walletBalance;

    if (type === 'credit') {
        user.walletBalance += Number(amount);
    } else {
        user.walletBalance -= Number(amount);
    }

    await user.save();

    // Audit Log
    await AuditLog.create({
        admin: req.user._id,
        action: `MANUAL_${type.toUpperCase()}`,
        targetId: user._id,
        targetType: 'User',
        details: { previousBalance, newBalance: user.walletBalance, amount, reason },
        note: note || reason
    });

    res.json({ success: true, newBalance: user.walletBalance, userName: user.name });
};

// @desc    Toggle Account Status (Ban/Unban)
// @route   PUT /api/admin/user/:id/status
const toggleAccountStatus = async (req, res) => {
    const { isActive, note } = req.body;
    let account = await User.findById(req.params.id);
    let type = 'User';

    if (!account) {
        account = await Vendor.findById(req.params.id);
        type = 'Vendor';
    }

    if (!account) {
        res.status(404);
        throw new Error('User or Vendor not found');
    }

    account.isActive = isActive;
    
    if (note) {
        account.adminNotes.push({
            content: `Account ${isActive ? 'activated' : 'deactivated'}: ${note}`,
            adminId: req.user._id
        });
    }

    await account.save();

    await AuditLog.create({
        admin: req.user._id,
        action: isActive ? 'ACTIVATE_ACCOUNT' : 'BAN_ACCOUNT',
        targetId: account._id,
        targetType: type,
        note
    });

    res.json({ success: true, isActive: account.isActive, isBanned: !account.isActive });
};

// @desc    Get Audit Logs
// @route   GET /api/admin/audit-logs
const getAuditLogs = async (req, res) => {
    const logs = await AuditLog.find({})
        .populate('admin', 'name email')
        .sort({ createdAt: -1 })
        .limit(100);
    res.json(logs);
};

// @desc    Get Debtors (Aging Analysis)
// @route   GET /api/admin/debtors
const getDebtors = async (req, res) => {
    // 1. Marketplace Debtors
    const activeOrders = await Order.find({
        status: { $in: ['goods_received', 'vendor_settled'] },
        isPaid: false
    }).populate('retailer', 'name phone email creditLimit');

    const orderDebtors = activeOrders.map(order => {
        const dueDate = new Date(order.dueDate);
        const today = new Date();
        const diffTime = dueDate - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

        return {
            orderId: order._id,
            type: 'Marketplace',
            user: order.retailer,
            amount: order.totalRepaymentAmount,
            dueDate: order.dueDate,
            daysRemaining: diffDays,
            isCritical: diffDays <= 3
        };
    });

    // 2. AAP Debtors
    const activeAAPs = await AgentPurchase.find({
        status: { $in: ['received', 'delivered'] },
        isPaid: false
    }).populate('retailer', 'name phone email creditLimit');

    const aapDebtors = activeAAPs.map(aap => {
        const dueDate = aap.dueDate ? new Date(aap.dueDate) : null;
        const today = new Date();
        const diffTime = dueDate ? (dueDate - today) : null;
        const diffDays = diffTime !== null ? Math.ceil(diffTime / (1000 * 60 * 60 * 24)) : 99; 

        return {
            orderId: aap._id,
            type: 'AAP',
            productName: aap.productName,
            user: aap.retailer,
            amount: aap.totalRetailerCost,
            dueDate: aap.dueDate,
            daysRemaining: diffDays,
            isCritical: diffDays <= 3
        };
    });

    const debtors = [...orderDebtors, ...aapDebtors];

    // Sort by urgency (lowest days remaining first)
    debtors.sort((a, b) => a.daysRemaining - b.daysRemaining);

    res.json(debtors);
};



// @desc    Broadcast Message to Users
// @route   POST /api/admin/broadcast
const sendBroadcast = async (req, res) => {
    const { subject, message, target } = req.body; // target: 'all', 'retailers', 'vendors'

    let recipients = [];

    if (target === 'retailers' || target === 'all') {
        const retailers = await User.find({}).select('email');
        recipients.push(...retailers);
    }

    if (target === 'vendors' || target === 'all') {
        const vendors = await Vendor.find({}).select('email');
        recipients.push(...vendors);
    }

    // Extract emails
    const emailAddresses = recipients.map(r => r.email).filter(e => e);

    // In a real production app, use a queue (Bull/RabbitMQ). 
    // For now, we'll try to send in batches or just map (simple for MVP).
    
    // We don't want to wait for all to complete to respond to UI, 
    // but we should probably await at least the initiation.
    
    // Using Promise.allSettled to ensure one failure doesn't stop others
    const results = await Promise.allSettled(emailAddresses.map(email => 
        sendEmail({
            to: email,
            subject: `📢 ${subject}`,
            text: message,
            html: `<div style="font-family: sans-serif; padding: 20px; color: #333;">
                    <h2 style="color: #10b981;">Amana Update</h2>
                    <p>${message.replace(/\n/g, '<br>')}</p>
                    <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
                    <p style="font-size: 12px; color: #888;">You received this message as a registered user of Amana.</p>
                   </div>`
        })
    ));

    const successCount = results.filter(r => r.status === 'fulfilled').length;

    await AuditLog.create({
        admin: req.user._id,
        action: 'BROADCAST_MESSAGE',
        targetType: 'System',
        details: { target, subject, successCount, total: emailAddresses.length }
    });

    res.json({ 
        message: `Broadcast initiated to ${emailAddresses.length} users`, 
        successCount 
    });
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
    searchRetailers,
    // New Exports
    getUniversalSearch,
    getAdvancedFinancials,
    getUserFullProfile,
    manualLedgerEntry,
    toggleAccountStatus,
    getAuditLogs,
    getDebtors,
    sendBroadcast
};
