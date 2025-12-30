const AgentPurchase = require('../models/AgentPurchase');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { determineMarkup } = require('../utils/amanaEngine');

// @desc    Create AAP Draft (Agent captures product)
// @route   POST /api/aap
// @access  Private (Agent)
const createAAP = async (req, res, next) => {
    try {
        const agent = await User.findById(req.user._id);
        
        if (!agent || !agent.isAgent) {
            return res.status(403).json({ message: 'Only agents can create agent purchases' });
        }

        const { 
            productName, 
            productDescription, 
            quantity, 
            productPhotos, 
            sellerName, 
            sellerPhone, 
            sellerLocation,
            purchasePrice,
            repaymentTerm = 14,
            retailerId
        } = req.body;

        if (!productName || !purchasePrice) {
            return res.status(400).json({ message: 'Product name and price are required' });
        }

        if (!productPhotos || productPhotos.length === 0) {
            return res.status(400).json({ message: 'At least one product photo is required' });
        }

        const aapData = {
            agent: agent._id,
            productName,
            productDescription,
            quantity: quantity || 1,
            productPhotos,
            sellerName,
            sellerPhone,
            sellerLocation,
            purchasePrice,
            repaymentTerm,
            status: 'draft'
        };

        // Instant Linking Logic
        if (retailerId) {
            if (retailerId === req.user._id.toString()) {
                return res.status(400).json({ message: 'Agents cannot create Agent-Assisted Purchases for themselves. Please use another agent.' });
            }

            const retailer = await User.findById(retailerId);
            if (!retailer || retailer.role !== 'retailer' || retailer.verificationStatus !== 'approved') {
                return res.status(400).json({ message: 'Invalid or unapproved retailer' });
            }

            // Calculate markup using Amana Engine
            const markupPercentage = determineMarkup(retailer.amanaScore, repaymentTerm);
            const markupAmount = purchasePrice * (markupPercentage / 100);
            const totalRetailerCost = purchasePrice + markupAmount;

            // Credit Check
            const availableCredit = retailer.creditLimit - retailer.usedCredit;
            if (totalRetailerCost > availableCredit) {
                return res.status(400).json({
                    message: `Insufficient credit. Retailer needs ₦${totalRetailerCost.toLocaleString()} but has ₦${availableCredit.toLocaleString()} available.`,
                    creditRequired: totalRetailerCost,
                    creditAvailable: availableCredit
                });
            }

            // Enrich AAP data
            aapData.retailer = retailer._id;
            aapData.markupPercentage = markupPercentage;
            aapData.markupAmount = markupAmount;
            aapData.totalRetailerCost = totalRetailerCost;
            aapData.status = 'awaiting_retailer_confirm';
        }

        const aap = new AgentPurchase(aapData);
        const created = await aap.save();
        res.status(201).json(created);
    } catch (error) {
        next(error);
    }
};

// @desc    Link Retailer to AAP (triggers credit check)
// @route   PUT /api/aap/:id/link-retailer
// @access  Private (Agent)
const linkRetailer = async (req, res, next) => {
    try {
        const { retailerId, repaymentTerm } = req.body;

        if (!retailerId) {
            return res.status(400).json({ message: 'Retailer ID is required' });
        }

        const aap = await AgentPurchase.findById(req.params.id);
        
        if (!aap) {
            return res.status(404).json({ message: 'Agent purchase not found' });
        }

        if (aap.agent.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        if (aap.status !== 'draft') {
            return res.status(400).json({ message: 'Can only link retailer to draft purchases' });
        }

        if (retailerId === req.user._id.toString()) {
            return res.status(400).json({ message: 'Agents cannot link themselves as retailers for Agent-Assisted Purchases.' });
        }

        const retailer = await User.findById(retailerId);
        
        if (!retailer) {
            return res.status(404).json({ message: 'Retailer not found' });
        }

        if (retailer.role !== 'retailer') {
            return res.status(400).json({ message: 'Selected user is not a retailer' });
        }

        // Update repayment term if provided
        const term = repaymentTerm || aap.repaymentTerm || 14;
        
        // Calculate markup using Amana Engine
        const markupPercentage = determineMarkup(retailer.amanaScore, term);
        const markupAmount = aap.purchasePrice * (markupPercentage / 100);
        const totalRetailerCost = aap.purchasePrice + markupAmount;

        // AUTO CREDIT CHECK
        const availableCredit = retailer.creditLimit - retailer.usedCredit;

        if (totalRetailerCost > availableCredit) {
            return res.status(400).json({ 
                message: `Insufficient credit. Retailer needs ₦${totalRetailerCost.toLocaleString()} but has ₦${availableCredit.toLocaleString()} available.`,
                creditRequired: totalRetailerCost,
                creditAvailable: availableCredit
            });
        }

        // Credit check passed - update AAP
        aap.retailer = retailer._id;
        aap.repaymentTerm = term;
        aap.markupPercentage = markupPercentage;
        aap.markupAmount = markupAmount;
        aap.totalRetailerCost = totalRetailerCost;
        aap.status = 'awaiting_retailer_confirm';

        const updated = await aap.save();
        
        await updated.populate('retailer', 'name phone email businessInfo amanaScore creditLimit usedCredit');
        await updated.populate('agent', 'name phone email');

        res.json({
            message: 'Credit check passed. Awaiting retailer confirmation.',
            aap: updated
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Retailer confirms they want the product
// @route   PUT /api/aap/:id/confirm
// @access  Private (Retailer)
const retailerConfirm = async (req, res, next) => {
    try {
        const aap = await AgentPurchase.findById(req.params.id);
        
        if (!aap) {
            return res.status(404).json({ message: 'Agent purchase not found' });
        }

        if (aap.retailer.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        if (aap.status !== 'awaiting_retailer_confirm') {
            return res.status(400).json({ message: 'This purchase is not awaiting your confirmation' });
        }

        aap.status = 'pending_admin_approval';
        aap.retailerConfirmedAt = new Date();

        const updated = await aap.save();
        
        await updated.populate('retailer', 'name phone email businessInfo');
        await updated.populate('agent', 'name phone email');

        res.json({
            message: 'Confirmed! Request sent to admin for approval.',
            aap: updated
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Retailer declines the purchase
// @route   PUT /api/aap/:id/decline
// @access  Private (Retailer or Admin)
const declineAAP = async (req, res, next) => {
    try {
        const { reason } = req.body;
        const aap = await AgentPurchase.findById(req.params.id);
        
        if (!aap) {
            return res.status(404).json({ message: 'Agent purchase not found' });
        }

        const isRetailer = aap.retailer && aap.retailer.toString() === req.user._id.toString();
        const isAdmin = req.user.role === 'admin';

        if (!isRetailer && !isAdmin) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        if (['received', 'completed', 'declined'].includes(aap.status)) {
            return res.status(400).json({ message: 'Cannot decline at this stage' });
        }

        aap.status = 'declined';
        aap.declineReason = reason || (isAdmin ? 'Declined by admin' : 'Declined by retailer');

        const updated = await aap.save();
        res.json({ message: 'Purchase request declined', aap: updated });
    } catch (error) {
        next(error);
    }
};

// @desc    Admin approves and disburses funds
// @route   PUT /api/aap/:id/approve
// @access  Private (Admin)
const adminApprove = async (req, res, next) => {
    try {
        const { disbursementMethod, disbursementReference } = req.body;

        if (!disbursementMethod) {
            return res.status(400).json({ message: 'Disbursement method is required' });
        }

        const aap = await AgentPurchase.findById(req.params.id);
        
        if (!aap) {
            return res.status(404).json({ message: 'Agent purchase not found' });
        }

        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Admin access required' });
        }

        if (aap.status !== 'pending_admin_approval') {
            return res.status(400).json({ message: 'This purchase is not pending admin approval' });
        }

        // Final credit check before approval
        const retailer = await User.findById(aap.retailer);
        const availableCredit = retailer.creditLimit - retailer.usedCredit;

        if (aap.totalRetailerCost > availableCredit) {
            return res.status(400).json({ 
                message: 'Retailer no longer has sufficient credit',
                creditRequired: aap.totalRetailerCost,
                creditAvailable: availableCredit
            });
        }

        // Set 1-hour expiry timer
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 60 * 60 * 1000); // +1 hour

        aap.approvedBy = req.user._id;
        aap.disbursedAmount = aap.purchasePrice;
        aap.disbursementMethod = disbursementMethod;
        aap.disbursementReference = disbursementReference || `AAP-${aap._id.toString().slice(-6).toUpperCase()}`;
        aap.status = 'fund_disbursed';
        aap.adminApprovedAt = now;
        aap.fundDisbursedAt = now;
        aap.expiresAt = expiresAt;

        const updated = await aap.save();

        // Log transaction
        await Transaction.create({
            user: aap.agent,
            type: 'agent_fund_disbursement',
            amount: aap.purchasePrice,
            description: `Funds disbursed for AAP ${aap._id} - Product: ${aap.productName}`,
            reference: aap.disbursementReference,
            status: 'success',
            agentPurchaseId: aap._id
        });

        await updated.populate('retailer', 'name phone email');
        await updated.populate('agent', 'name phone email');
        await updated.populate('approvedBy', 'name');

        res.json({
            message: 'Approved! Agent has 1 hour to complete purchase.',
            expiresAt,
            aap: updated
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Agent marks goods as delivered, generates OTP
// @route   PUT /api/aap/:id/deliver
// @access  Private (Agent)
const markDelivered = async (req, res, next) => {
    try {
        const aap = await AgentPurchase.findById(req.params.id);
        
        if (!aap) {
            return res.status(404).json({ message: 'Agent purchase not found' });
        }

        if (aap.agent.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        if (aap.status !== 'fund_disbursed') {
            return res.status(400).json({ message: 'Cannot mark as delivered at this stage' });
        }

        // Check if expired
        if (new Date() > aap.expiresAt) {
            aap.status = 'expired';
            await aap.save();
            return res.status(400).json({ message: 'This purchase has expired (1hr limit exceeded)' });
        }

        // Generate OTP
        const pickupCode = aap.generatePickupCode();
        
        aap.status = 'delivered';
        aap.deliveredAt = new Date();

        const updated = await aap.save();

        res.json({
            message: 'Marked as delivered. Share this OTP with the retailer.',
            pickupCode,
            aap: updated
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Retailer confirms receipt with OTP
// @route   PUT /api/aap/:id/receive
// @access  Private (Retailer)
const confirmReceipt = async (req, res, next) => {
    try {
        const { pickupCode } = req.body;

        if (!pickupCode) {
            return res.status(400).json({ message: 'Pickup code is required' });
        }

        const aap = await AgentPurchase.findById(req.params.id);
        
        if (!aap) {
            return res.status(404).json({ message: 'Agent purchase not found' });
        }

        if (aap.retailer.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        if (aap.status !== 'delivered') {
            return res.status(400).json({ message: 'Goods must be marked as delivered first' });
        }

        if (aap.pickupCode !== pickupCode) {
            return res.status(400).json({ message: 'Invalid pickup code' });
        }

        // Lock retailer's credit
        const retailer = await User.findById(aap.retailer);
        retailer.usedCredit += aap.totalRetailerCost;
        await retailer.save();

        // Set due date
        const termDays = aap.repaymentTerm || 14;
        const dueDate = new Date(Date.now() + termDays * 24 * 60 * 60 * 1000);

        aap.status = 'received';
        aap.receivedAt = new Date();
        aap.dueDate = dueDate;

        const updated = await aap.save();

        // Log transaction
        await Transaction.create({
            user: retailer._id,
            type: 'loan_disbursement',
            amount: aap.totalRetailerCost,
            description: `AAP Credit Lock - ${aap.productName} (${aap.repaymentTerm} days)`,
            status: 'success',
            agentPurchaseId: aap._id
        });

        await updated.populate('retailer', 'name phone email');
        await updated.populate('agent', 'name phone email');

        res.json({
            message: 'Receipt confirmed! Credit has been locked.',
            dueDate,
            aap: updated
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get AAP by ID
// @route   GET /api/aap/:id
// @access  Private
const getAAPById = async (req, res, next) => {
    try {
        const aap = await AgentPurchase.findById(req.params.id)
            .populate('retailer', 'name phone email businessInfo amanaScore')
            .populate('agent', 'name phone email')
            .populate('approvedBy', 'name');

        if (!aap) {
            return res.status(404).json({ message: 'Agent purchase not found' });
        }

        // Check authorization
        const isAgent = aap.agent._id.toString() === req.user._id.toString();
        const isRetailer = aap.retailer && aap.retailer._id.toString() === req.user._id.toString();
        const isAdmin = req.user.role === 'admin';

        if (!isAgent && !isRetailer && !isAdmin) {
            return res.status(403).json({ message: 'Not authorized to view this purchase' });
        }

        res.json(aap);
    } catch (error) {
        next(error);
    }
};

// @desc    Get Agent's AAP Queue
// @route   GET /api/aap/agent/queue
// @access  Private (Agent)
const getAgentQueue = async (req, res, next) => {
    try {
        if (!req.user.isAgent) {
            return res.status(403).json({ message: 'Agent access required' });
        }

        const aaps = await AgentPurchase.find({ agent: req.user._id })
            .populate('retailer', 'name phone email businessInfo')
            .sort({ createdAt: -1 });

        res.json(aaps);
    } catch (error) {
        next(error);
    }
};

// @desc    Get Retailer's AAP Orders
// @route   GET /api/aap/retailer/mine
// @access  Private (Retailer)
const getRetailerAAPs = async (req, res, next) => {
    try {
        const aaps = await AgentPurchase.find({ retailer: req.user._id })
            .populate('agent', 'name phone email')
            .sort({ createdAt: -1 });

        res.json(aaps);
    } catch (error) {
        next(error);
    }
};

// @desc    Admin Dashboard - All AAPs
// @route   GET /api/aap/admin/dashboard
// @access  Private (Admin)
const getAdminDashboard = async (req, res, next) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Admin access required' });
        }

        const { status } = req.query;

        let query = {};
        if (status) {
            query.status = status;
        }

        const aaps = await AgentPurchase.find(query)
            .populate('retailer', 'name phone email businessInfo amanaScore creditLimit usedCredit')
            .populate('agent', 'name phone email')
            .populate('approvedBy', 'name')
            .sort({ createdAt: -1 });

        // Summary stats
        const stats = {
            pending: await AgentPurchase.countDocuments({ status: 'pending_admin_approval' }),
            active: await AgentPurchase.countDocuments({ status: 'fund_disbursed' }),
            delivered: await AgentPurchase.countDocuments({ status: 'delivered' }),
            expired: await AgentPurchase.countDocuments({ status: 'expired' }),
            completed: await AgentPurchase.countDocuments({ status: { $in: ['received', 'completed'] } })
        };

        res.json({ aaps, stats });
    } catch (error) {
        next(error);
    }
};

// @desc    Get Expired AAPs (Admin Alert)
// @route   GET /api/aap/admin/expired
// @access  Private (Admin)
const getExpiredAAPs = async (req, res, next) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Admin access required' });
        }

        const expiredAAPs = await AgentPurchase.find({ status: 'expired' })
            .populate('retailer', 'name phone email')
            .populate('agent', 'name phone email')
            .sort({ expiresAt: -1 });

        res.json(expiredAAPs);
    } catch (error) {
        next(error);
    }
};

// @desc    Search retailers (for agent linking)
// @route   GET /api/aap/search-retailers
// @access  Private (Agent)
const searchRetailers = async (req, res, next) => {
    try {
        if (!req.user.isAgent) {
            return res.status(403).json({ message: 'Agent access required' });
        }

        const { q } = req.query;

        if (!q || q.length < 2) {
            return res.status(400).json({ message: 'Search query must be at least 2 characters' });
        }

        const retailers = await User.find({
            role: 'retailer',
            verificationStatus: 'approved',
            $or: [
                { name: { $regex: q, $options: 'i' } },
                { phone: { $regex: q, $options: 'i' } },
                { 'businessInfo.businessName': { $regex: q, $options: 'i' } }
            ]
        }).select('name phone email businessInfo amanaScore creditLimit usedCredit').limit(10);

        res.json(retailers);
    } catch (error) {
        next(error);
    }
};

// @desc    Find retailer by phone (for precise lookup)
// @route   GET /api/aap/find-retailer
// @access  Private (Agent)
const findRetailerByPhone = async (req, res, next) => {
    try {
        if (!req.user.isAgent) {
            return res.status(403).json({ message: 'Agent access required' });
        }

        const { phone } = req.query;

        if (!phone) {
            return res.status(400).json({ message: 'Phone number is required' });
        }

        // Normalize phone (simple version: exact match first)
        const retailer = await User.findOne({
            role: 'retailer',
            phone: phone,
            verificationStatus: 'approved'
        }).select('name phone email businessInfo amanaScore creditLimit usedCredit kyc');

        if (!retailer) {
            return res.status(404).json({ message: 'No approved retailer found with this phone number' });
        }

        res.json(retailer);
    } catch (error) {
        next(error);
    }
};

module.exports = {
    createAAP,
    linkRetailer,
    retailerConfirm,
    declineAAP,
    adminApprove,
    markDelivered,
    confirmReceipt,
    getAAPById,
    getAgentQueue,
    getRetailerAAPs,
    getAdminDashboard,
    getExpiredAAPs,
    searchRetailers,
    findRetailerByPhone
};
