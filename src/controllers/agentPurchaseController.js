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
            productPhotos, 
            sellerName, 
            sellerPhone, 
            sellerLocation,
            purchasePrice,
            repaymentTerm,
            retailerId,
            requestedDuration
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
            productPhotos,
            sellerName,
            sellerPhone,
            sellerLocation,
            purchasePrice,
            repaymentTerm,
            requestedDuration: requestedDuration && [1, 2, 4, 8, 12, 24, 48, 72].includes(Number(requestedDuration)) ? Number(requestedDuration) : undefined,
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

        // Atomic dedup: use findOneAndUpdate with upsert to prevent race conditions
        // Keep $set and $setOnInsert fields disjoint to avoid MongoDB "conflict" error
        let setOnInsert = { ...aapData };

        if (retailerId) {
            delete setOnInsert.retailer;
            delete setOnInsert.markupPercentage;
            delete setOnInsert.markupAmount;
            delete setOnInsert.totalRetailerCost;
            delete setOnInsert.status;

            update = {
                $setOnInsert: setOnInsert,
                $set: {
                    retailer: aapData.retailer,
                    markupPercentage: aapData.markupPercentage,
                    markupAmount: aapData.markupAmount,
                    totalRetailerCost: aapData.totalRetailerCost,
                    status: 'awaiting_retailer_confirm'
                }
            };
        } else {
            update = { $setOnInsert: setOnInsert };
        }

        const aap = await AgentPurchase.findOneAndUpdate(
            {
                agent: agent._id,
                productName,
                purchasePrice,
                status: { $in: ['draft', 'awaiting_retailer_confirm'] },
                createdAt: { $gte: new Date(Date.now() - 30000) }
            },
            update,
            {
                upsert: true,
                new: true,
                setDefaultsOnInsert: true
            }
        );

        if (aap.retailer) {
            await aap.populate('retailer', 'name phone email businessInfo amanaScore creditLimit usedCredit');
        }

        res.status(201).json(aap);
    } catch (error) {
        next(error);
    }
};

// @desc    Link Retailer to AAP (triggers credit check)
// @route   PUT /api/aap/:id/link-retailer
// @access  Private (Agent)
const linkRetailer = async (req, res, next) => {
    try {
        const { retailerId, repaymentTerm, requestedDuration } = req.body;

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

        if (!repaymentTerm || ![3, 7, 14].includes(repaymentTerm)) {
            return res.status(400).json({ message: 'Please select a repayment term (3, 7, or 14 days)' });
        }
        const term = repaymentTerm;
        
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
        if (requestedDuration && [1, 2, 4, 8, 12, 24, 48, 72].includes(Number(requestedDuration))) {
            aap.requestedDuration = Number(requestedDuration);
        }

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

        // Idempotency: if already confirmed, return success
        if (aap.status === 'pending_admin_approval') {
            await aap.populate('retailer', 'name phone email businessInfo');
            await aap.populate('agent', 'name phone email');
            return res.json({
                message: 'Interest recorded! Amana will review your request. You will receive the final Murabaha sale terms after we acquire the goods.',
                aap
            });
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
            message: 'Interest recorded! By confirming, you have expressed your intent to purchase this product through Amana Murabaha. Once we acquire the goods, you will be presented with the final sale terms for your acceptance. Amana will review your request shortly.',
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

        if (['received', 'completed', 'declined', 'expired'].includes(aap.status)) {
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
        const { disbursementMethod, disbursementReference, duration } = req.body;

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

        // Use admin-provided duration, fallback to agent requested, default 1 hour
        const effectiveHours = duration && [1, 2, 4, 8, 12, 24, 48, 72].includes(Number(duration))
            ? Number(duration)
            : (aap.requestedDuration || 1);
        
        const now = new Date();
        const expiresAt = new Date(now.getTime() + effectiveHours * 60 * 60 * 1000);

        aap.approvedBy = req.user._id;
        aap.disbursedAmount = aap.purchasePrice;
        aap.disbursementMethod = disbursementMethod;
        aap.disbursementReference = disbursementReference || `AAP-${aap._id.toString().slice(-6).toUpperCase()}`;
        aap.adminAdjustedDuration = effectiveHours;
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
            message: `Approved! ₦${aap.purchasePrice.toLocaleString()} disbursed to ${aap.agent?.name || 'agent'}. Duration: ${effectiveHours} hour${effectiveHours > 1 ? 's' : ''}.`,
            expiresAt,
            duration: effectiveHours,
            aap: updated
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Agent sends Murabaha sale offer to retailer
// @route   PUT /api/aap/:id/send-murabaha-offer
// @access  Private (Agent)
const sendMurabahaOffer = async (req, res, next) => {
    try {
        const { photoProof } = req.body || {};

        const aap = await AgentPurchase.findById(req.params.id);
        
        if (!aap) {
            return res.status(404).json({ message: 'Agent purchase not found' });
        }

        if (aap.agent.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        if (aap.status !== 'fund_disbursed') {
            return res.status(400).json({ message: 'Funds must be disbursed before sending Murabaha offer' });
        }

        // Check if expired
        if (aap.expiresAt && new Date() > aap.expiresAt) {
            aap.status = 'expired';
            await aap.save();
            return res.status(400).json({ message: 'This purchase has expired (duration exceeded). Contact admin.' });
        }

        aap.status = 'pending_murabaha_acceptance';
        aap.murabahaOfferSentAt = new Date();
        if (photoProof) {
            aap.proxyProofUrl = photoProof;
        }

        const updated = await aap.save();

        await updated.populate('retailer', 'name phone email');
        await updated.populate('agent', 'name phone email');

        res.json({
            message: `Murabaha offer sent to ${aap.retailer?.name || 'retailer'}. Awaiting their acceptance.`,
            offer: {
                purchasePrice: aap.purchasePrice,
                markupPercentage: aap.markupPercentage,
                markupAmount: aap.markupAmount,
                totalRetailerCost: aap.totalRetailerCost,
                repaymentTerm: aap.repaymentTerm
            },
            aap: updated
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Retailer accepts the Murabaha sale offer
// @route   PUT /api/aap/:id/accept-murabaha
// @access  Private (Retailer)
const acceptMurabaha = async (req, res, next) => {
    try {
        const aap = await AgentPurchase.findById(req.params.id);
        
        if (!aap) {
            return res.status(404).json({ message: 'Agent purchase not found' });
        }

        if (aap.retailer.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        if (aap.status !== 'pending_murabaha_acceptance') {
            return res.status(400).json({ message: 'No pending Murabaha offer to accept' });
        }

        // Final credit check
        const retailer = await User.findById(aap.retailer);
        const availableCredit = retailer.creditLimit - retailer.usedCredit;
        if (aap.totalRetailerCost > availableCredit) {
            return res.status(400).json({
                message: `Insufficient credit to complete this purchase. You need ₦${aap.totalRetailerCost.toLocaleString()} but only ₦${availableCredit.toLocaleString()} available.`,
                creditRequired: aap.totalRetailerCost,
                creditAvailable: availableCredit
            });
        }

        aap.status = 'murabaha_accepted';
        aap.murabahaAcceptedAt = new Date();

        const updated = await aap.save();

        await updated.populate('retailer', 'name phone email');
        await updated.populate('agent', 'name phone email');

        res.json({
            message: `You have accepted the Murabaha sale. Amana purchased ${aap.productName} at ₦${aap.purchasePrice.toLocaleString()} and sells it to you at ₦${aap.totalRetailerCost.toLocaleString()} (${aap.markupPercentage}% markup). Due in ${aap.repaymentTerm} days after delivery. Awaiting delivery.`,
            aap: updated
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Agent confirms Murabaha acceptance on retailer's behalf (proxy)
// @route   PUT /api/aap/:id/proxy-accept-murabaha
// @access  Private (Agent)
const proxyAcceptMurabaha = async (req, res, next) => {
    try {
        const { photoProof } = req.body;

        if (!photoProof) {
            return res.status(400).json({ message: 'Photo proof is required for proxy Murabaha acceptance' });
        }

        const aap = await AgentPurchase.findById(req.params.id);
        
        if (!aap) {
            return res.status(404).json({ message: 'Agent purchase not found' });
        }

        if (aap.agent.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Only the creating agent can perform proxy Murabaha acceptance' });
        }

        if (aap.status !== 'fund_disbursed' && aap.status !== 'pending_murabaha_acceptance') {
            return res.status(400).json({ message: 'Cannot accept Murabaha at this stage. Funds must be disbursed first.' });
        }

        // Final credit check
        const retailer = await User.findById(aap.retailer);
        const availableCredit = retailer.creditLimit - retailer.usedCredit;
        if (aap.totalRetailerCost > availableCredit) {
            return res.status(400).json({
                message: `Retailer has insufficient credit. Needs ₦${aap.totalRetailerCost.toLocaleString()} but only ₦${availableCredit.toLocaleString()} available.`,
                creditRequired: aap.totalRetailerCost,
                creditAvailable: availableCredit
            });
        }

        if (aap.status === 'fund_disbursed') {
            aap.murabahaOfferSentAt = new Date();
        }
        aap.status = 'murabaha_accepted';
        aap.murabahaAcceptedAt = new Date();
        aap.proxyMurabahaAcceptance = true;
        aap.proxyProofUrl = photoProof;

        const updated = await aap.save();

        await updated.populate('retailer', 'name phone email');
        await updated.populate('agent', 'name phone email');

        res.json({
            message: `Proxy Murabaha acceptance complete. Amana purchased ${aap.productName} at ₦${aap.purchasePrice.toLocaleString()} and sells to ${aap.retailer?.name || 'retailer'} at ₦${aap.totalRetailerCost.toLocaleString()} (${aap.markupPercentage}% markup).`,
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

        if (aap.status !== 'murabaha_accepted') {
            return res.status(400).json({ message: 'Murabaha terms must be accepted before delivery' });
        }

        // Check if expired
        if (aap.expiresAt && new Date() > aap.expiresAt) {
            aap.status = 'expired';
            await aap.save();
            return res.status(400).json({ message: 'This purchase has expired (duration exceeded). Contact admin.' });
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

        // Idempotency: if already received, return success
        if (aap.status === 'received' || aap.status === 'completed') {
            await aap.populate('retailer', 'name phone email');
            await aap.populate('agent', 'name phone email');
            return res.json({
                message: `Goods received! ₦${aap.totalRetailerCost?.toLocaleString()} added to your repayment balance. Due by ${new Date(aap.dueDate).toLocaleDateString()}.`,
                dueDate: aap.dueDate,
                aap
            });
        }

        if (aap.status !== 'delivered') {
            return res.status(400).json({ message: 'Goods must be marked as delivered first' });
        }

        if (aap.pickupCode !== pickupCode) {
            return res.status(400).json({ message: 'Invalid pickup code' });
        }

        // Lock retailer's credit
        const retailer = await User.findById(aap.retailer);
        const newUsedCredit = retailer.usedCredit + aap.totalRetailerCost;
        if (newUsedCredit > retailer.creditLimit) {
            return res.status(400).json({
                message: `Cannot confirm receipt — retailer would exceed credit limit. Needs ₦${aap.totalRetailerCost.toLocaleString()} but only ₦${(retailer.creditLimit - retailer.usedCredit).toLocaleString()} available.`
            });
        }
        retailer.usedCredit = newUsedCredit;
        await retailer.save();

        // Set due date
        const termDays = Number.isFinite(aap.repaymentTerm) ? aap.repaymentTerm : 14;
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
            description: `AAP Credit Lock - ${aap.productName} (${termDays} days)`,
            status: 'success',
            agentPurchaseId: aap._id
        });

        await updated.populate('retailer', 'name phone email');
        await updated.populate('agent', 'name phone email');

        res.json({
            message: `Goods received! ₦${aap.totalRetailerCost.toLocaleString()} added to your repayment balance. Due by ${dueDate.toLocaleDateString()}. Thank you for choosing Amana Murabaha.`,
            dueDate,
            aap: updated
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Agent Proxy Confirmation (Confirm for Retailer)
// @route   PUT /api/aap/:id/proxy-confirm
// @access  Private (Agent)
const proxyConfirmAAP = async (req, res, next) => {
    try {
        const { photoProof } = req.body; // URL from Cloudinary

        if (!photoProof) {
            return res.status(400).json({ message: 'Photo proof is required for proxy confirmation' });
        }

        const aap = await AgentPurchase.findById(req.params.id);
        
        if (!aap) {
            return res.status(404).json({ message: 'Agent purchase not found' });
        }

        if (aap.agent.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Only the creating agent can perform proxy confirmation' });
        }

        // Idempotency: if already proxy confirmed, return success
        if (aap.status === 'pending_admin_approval') {
            await aap.populate('retailer', 'name phone email businessInfo');
            await aap.populate('agent', 'name phone email');
            return res.json({
                message: 'Interest recorded via agent. Amana will review your request.',
                aap
            });
        }

        if (aap.status !== 'awaiting_retailer_confirm') {
            return res.status(400).json({ message: 'This purchase is not awaiting confirmation' });
        }

        // Apply Proxy Logic
        aap.status = 'pending_admin_approval';
        aap.retailerConfirmedAt = new Date();
        aap.proxyConfirmation = true;
        aap.proxyProofUrl = photoProof;

        const updated = await aap.save();
        
        await updated.populate('retailer', 'name phone email businessInfo');
        await updated.populate('agent', 'name phone email');

        res.json({
            message: 'Interest recorded via agent. The retailer has expressed intent to purchase through Amana Murabaha. Amana will review the request.',
            aap: updated
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Agent Proxy Delivery (Mark Received for Retailer)
// @route   PUT /api/aap/:id/proxy-deliver
// @access  Private (Agent)
const proxyDeliverAAP = async (req, res, next) => {
    try {
        const { photoProof } = req.body;

        if (!photoProof) {
            return res.status(400).json({ message: 'Photo proof is required for proxy delivery' });
        }

        const aap = await AgentPurchase.findById(req.params.id);
        
        if (!aap) {
            return res.status(404).json({ message: 'Agent purchase not found' });
        }

        if (aap.agent.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Only the creating agent can perform proxy delivery' });
        }

        // Idempotency: if already received, return success
        if (aap.status === 'received' || aap.status === 'completed') {
            await aap.populate('retailer', 'name phone email');
            await aap.populate('agent', 'name phone email');
            return res.json({
                message: 'Proxy Receipt Confirmed! Credit has been locked.',
                dueDate: aap.dueDate,
                aap
            });
        }

        if (aap.status !== 'delivered' && aap.status !== 'murabaha_accepted') {
            return res.status(400).json({ message: 'Murabaha terms must be accepted before delivery' });
        }

        // Lock retailer's credit
        const retailer = await User.findById(aap.retailer);
        const newUsedCredit = retailer.usedCredit + aap.totalRetailerCost;
        if (newUsedCredit > retailer.creditLimit) {
            return res.status(400).json({
                message: `Cannot confirm proxy delivery — retailer would exceed credit limit. Needs ₦${aap.totalRetailerCost.toLocaleString()} but only ₦${(retailer.creditLimit - retailer.usedCredit).toLocaleString()} available.`
            });
        }
        retailer.usedCredit = newUsedCredit;
        await retailer.save();

        // Set due date
        const termDays = Number.isFinite(aap.repaymentTerm) ? aap.repaymentTerm : 14;
        const dueDate = new Date(Date.now() + termDays * 24 * 60 * 60 * 1000);

        // If skipping 'delivered' state, set timestamp
        if (aap.status === 'murabaha_accepted') {
            aap.deliveredAt = new Date();
        }

        aap.status = 'received';
        aap.receivedAt = new Date();
        aap.dueDate = dueDate;
        aap.proxyReceipt = true;
        aap.proxyProofUrl = photoProof;

        const updated = await aap.save();

        // Log transaction
        await Transaction.create({
            user: retailer._id,
            type: 'loan_disbursement',
            amount: aap.totalRetailerCost,
            description: `AAP Credit Lock (Proxy) - ${aap.productName} (${termDays} days)`,
            status: 'success',
            agentPurchaseId: aap._id
        });

        await updated.populate('retailer', 'name phone email');
        await updated.populate('agent', 'name phone email');

        res.json({
            message: 'Proxy Receipt Confirmed! Credit has been locked.',
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
            .populate('retailer', 'name phone email businessInfo amanaScore creditLimit usedCredit kyc.profilePicUrl')
            .populate('agent', 'name phone email')
            .populate('approvedBy', 'name')
            .sort({ createdAt: -1 });

        // Summary stats
        const stats = {
            pending: await AgentPurchase.countDocuments({ status: 'pending_admin_approval' }),
            active: await AgentPurchase.countDocuments({ status: { $in: ['fund_disbursed', 'pending_murabaha_acceptance'] } }),
            murabahaPending: await AgentPurchase.countDocuments({ status: 'pending_murabaha_acceptance' }),
            murabahaAccepted: await AgentPurchase.countDocuments({ status: 'murabaha_accepted' }),
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

// @desc    Agent cancels AAP before payment
// @route   PUT /api/aap/:id/cancel
// @access  Private (Agent who created)
const cancelAAP = async (req, res, next) => {
    try {
        const aap = await AgentPurchase.findById(req.params.id);

        if (!aap) {
            return res.status(404).json({ message: 'Agent purchase not found' });
        }

        if (aap.agent.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Only the creating agent can cancel this purchase' });
        }

        if (!['draft', 'awaiting_retailer_confirm', 'pending_admin_approval'].includes(aap.status)) {
            return res.status(400).json({ message: 'Cannot cancel at this stage. This purchase has already been processed.' });
        }

        aap.status = 'cancelled';
        aap.cancelledBy = req.user._id;
        aap.cancelledAt = new Date();
        aap.cancelReason = req.body.reason || 'Cancelled by agent';

        const updated = await aap.save();

        await Transaction.create({
            user: req.user._id,
            type: 'refund',
            amount: 0,
            description: `AAP cancelled before payment - ${aap.productName} (${aap.cancelReason})`,
            status: 'success',
            agentPurchaseId: aap._id
        });

        await updated.populate('retailer', 'name phone email');
        await updated.populate('agent', 'name phone email');

        res.json({ message: 'Purchase cancelled successfully', aap: updated });
    } catch (error) {
        next(error);
    }
};

// @desc    Agent requests cancellation after payment
// @route   PUT /api/aap/:id/request-cancellation
// @access  Private (Agent who created)
const requestCancellation = async (req, res, next) => {
    try {
        const aap = await AgentPurchase.findById(req.params.id);

        if (!aap) {
            return res.status(404).json({ message: 'Agent purchase not found' });
        }

        if (aap.agent.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Only the creating agent can request cancellation' });
        }

        if (!['fund_disbursed', 'pending_murabaha_acceptance', 'murabaha_accepted', 'delivered'].includes(aap.status)) {
            return res.status(400).json({ message: 'Cannot request cancellation at this stage.' });
        }

        if (!req.body.reason || req.body.reason.trim().length < 5) {
            return res.status(400).json({ message: 'Please provide a reason (at least 5 characters)' });
        }

        if (!req.body.refundProofUrl) {
            return res.status(400).json({ message: 'Please upload a receipt/proof of the refund payment' });
        }

        aap.status = 'cancellation_requested';
        aap.cancelledBy = req.user._id;
        aap.cancelledAt = new Date();
        aap.cancelReason = req.body.reason;
        aap.refundProofUrl = req.body.refundProofUrl;

        const updated = await aap.save();

        await Transaction.create({
            user: req.user._id,
            type: 'refund',
            amount: aap.disbursedAmount || aap.purchasePrice,
            description: `Cancellation requested for AAP - ${aap.productName}. Reason: ${aap.cancelReason}. Proof uploaded. Awaiting admin confirmation.`,
            status: 'pending',
            agentPurchaseId: aap._id
        });

        await updated.populate('retailer', 'name phone email');
        await updated.populate('agent', 'name phone email');

        res.json({
            message: 'Cancellation request submitted. Return the funds to the admin account below and await confirmation.',
            adminAccount: {
                bank: 'Moniepoint',
                accountName: 'Amana Murabaha Global Enterprise',
                accountNumber: '6042197639'
            },
            aap: updated
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Admin confirms cash returned and approves cancellation
// @route   PUT /api/aap/:id/approve-cancellation
// @access  Private (Admin)
const approveCancellation = async (req, res, next) => {
    try {
        const aap = await AgentPurchase.findById(req.params.id);

        if (!aap) {
            return res.status(404).json({ message: 'Agent purchase not found' });
        }

        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Admin access required' });
        }

        if (aap.status !== 'cancellation_requested') {
            return res.status(400).json({ message: 'This purchase has not requested cancellation' });
        }

        aap.status = 'cancelled';
        aap.cashReturnConfirmedBy = req.user._id;
        aap.cashReturnConfirmedAt = new Date();

        const updated = await aap.save();

        // Update the pending transaction to success
        await Transaction.updateMany(
            { agentPurchaseId: aap._id, type: 'refund', status: 'pending' },
            { status: 'success', description: `Cancellation approved by admin. Cash return confirmed for AAP - ${aap.productName}.` }
        );

        // Log admin action
        await Transaction.create({
            user: req.user._id,
            type: 'refund',
            amount: aap.disbursedAmount || aap.purchasePrice,
            description: `Admin approved cancellation and confirmed cash return for AAP - ${aap.productName}`,
            status: 'success',
            agentPurchaseId: aap._id
        });

        await updated.populate('retailer', 'name phone email');
        await updated.populate('agent', 'name phone email');
        await updated.populate('cashReturnConfirmedBy', 'name');

        res.json({ message: 'Cancellation approved. Cash return confirmed.', aap: updated });
    } catch (error) {
        next(error);
    }
};

// @desc    Admin views all pending cancellation requests
// @route   GET /api/aap/admin/cancellation-requests
// @access  Private (Admin)
const getCancellationRequests = async (req, res, next) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Admin access required' });
        }

        const requests = await AgentPurchase.find({ status: 'cancellation_requested' })
            .populate('agent', 'name phone email')
            .populate('retailer', 'name phone email')
            .populate('cancelledBy', 'name')
            .sort({ cancelledAt: -1 });

        const stats = {
            total: await AgentPurchase.countDocuments({ status: 'cancellation_requested' })
        };

        res.json({ requests, stats });
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
    sendMurabahaOffer,
    acceptMurabaha,
    proxyAcceptMurabaha,
    markDelivered,
    confirmReceipt,
    getAAPById,
    getAgentQueue,
    getRetailerAAPs,
    getAdminDashboard,
    getExpiredAAPs,
    searchRetailers,
    findRetailerByPhone,
    proxyConfirmAAP,
    proxyDeliverAAP,
    cancelAAP,
    requestCancellation,
    approveCancellation,
    getCancellationRequests
};
