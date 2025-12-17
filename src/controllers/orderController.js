const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const Vendor = require('../models/Vendor');
const Transaction = require('../models/Transaction');
const { determineMarkup } = require('../utils/amanaEngine');

// @desc    Create new order (Murabaha)
// @route   POST /api/orders
// @access  Private (Retailer)
const addOrderItems = async (req, res, next) => {
    try {
        const { orderItems, totalPrice } = req.body;

        if (orderItems && orderItems.length === 0) {
            return res.status(400).json({ message: 'No order items' });
        }

        // Validate stock for all items before processing
        for (const item of orderItems) {
            const product = await Product.findById(item.product);
            if (!product) {
                return res.status(404).json({ message: `Product not found: ${item.name}` });
            }
            if (!product.isActive) {
                return res.status(400).json({ message: `Product is no longer available: ${product.name}` });
            }
            if (product.countInStock < item.qty) {
                return res.status(400).json({ 
                    message: `Insufficient stock for ${product.name}. Available: ${product.countInStock}` 
                });
            }
        }

        const user = await User.findById(req.user._id);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const itemsPrice = Number(req.body.itemsPrice);
        
        // Identify Vendor (Assuming single vendor per order for MVP)
        const vendorId = orderItems[0].vendor; 

        // Murabaha Calculation - Centralized Engine (Tier Based)
        const markupPercentage = determineMarkup(user.amanaScore);
        const markupAmount = itemsPrice * (markupPercentage / 100);
        const totalRepayment = itemsPrice + markupAmount;

        // Credit Check - Only verify, DO NOT deduct yet
        const availableCredit = user.creditLimit - user.usedCredit;

        if (totalRepayment > availableCredit) {
            return res.status(400).json({ 
                message: `Insufficient Credit Limit. You need ₦${totalRepayment} but have ₦${availableCredit} available.` 
            });
        }

        // Decrement stock for each product
        for (const item of orderItems) {
            await Product.findByIdAndUpdate(item.product, {
                $inc: { countInStock: -item.qty }
            });
        }

        const order = new Order({
            retailer: user._id,
            vendor: vendorId,
            orderItems,
            itemsPrice,
            markupPercentage,
            markupAmount,
            totalRepaymentAmount: totalRepayment,
            status: 'pending_vendor',
            isPaid: false
        });

        const createdOrder = await order.save();

        res.status(201).json(createdOrder);
    } catch (error) {
        next(error);
    }
};

// @desc    Get Order by ID
// @route   GET /api/orders/:id
// @access  Private
const getOrderById = async (req, res, next) => {
    try {
        const order = await Order.findById(req.params.id)
            .populate('retailer', 'name email phone')
            .populate('vendor', 'businessName email phones address');

        if (order) {
            res.json(order);
        } else {
            return res.status(404).json({ message: 'Order not found' });
        }
    } catch (error) {
        next(error);
    }
};

// @desc    Update Order to Ready (Vendor Confirms - NO PAYMENT YET, Escrow Model)
// @route   PUT /api/orders/:id/ready
// @access  Private (Vendor)
const updateOrderToReady = async (req, res, next) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        // Verify ownership
        if (order.vendor.toString() !== req.user._id.toString()) {
            return res.status(401).json({ message: 'Not authorized' });
        }

        if (order.status !== 'pending_vendor') {
            return res.status(400).json({ message: 'Order already processed' });
        }

        const user = await User.findById(order.retailer);

        // Verify Credit Limit (just check, don't deduct yet)
        if ((user.usedCredit + order.totalRepaymentAmount) > user.creditLimit) {
            return res.status(400).json({ 
                message: 'User Credit Limit Exceeded. Cannot confirm order.' 
            });
        }

        // ESCROW: Only update status, NO financial transactions yet
        order.status = 'ready_for_pickup';
        order.pickupCode = Math.floor(1000 + Math.random() * 9000).toString();
        
        // Set Due Date (14 days from now - starts when vendor confirms)
        const fourteenDays = 14 * 24 * 60 * 60 * 1000;
        order.dueDate = new Date(Date.now() + fourteenDays);
        
        const updatedOrder = await order.save();
        
        res.json(updatedOrder);
    } catch (error) {
        console.error('Confirm Order Error:', error);
        res.status(500).json({ 
            message: error.message || 'Server Error during order confirmation',
            error: process.env.NODE_ENV === 'development' ? error.stack : null
        });
    }
};

// @desc    Confirm Goods Received (Retailer confirms receipt - PAYMENT EXECUTES HERE)
// @route   PUT /api/orders/:id/received
// @access  Private (Retailer)
const confirmGoodsReceived = async (req, res, next) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        if (order.retailer.toString() !== req.user._id.toString()) {
            return res.status(401).json({ message: 'Not authorized' });
        }

        if (order.status !== 'ready_for_pickup') {
            return res.status(400).json({ message: 'Order is not ready for pickup confirmation' });
        }

        const user = await User.findById(order.retailer);
        const vendor = await Vendor.findById(order.vendor);

        // ESCROW RELEASE: Now execute the financial transaction
        // 1. Update User Debt
        user.usedCredit += order.totalRepaymentAmount;
        await user.save();

        // 2. Credit Vendor Wallet
        vendor.walletBalance += order.itemsPrice;
        await vendor.save();

        // 3. Update Order
        order.status = 'goods_received';
        order.goodsReceivedAt = new Date();
        const updatedOrder = await order.save();

        // 4. Log Transaction
        await Transaction.create({
            user: user._id,
            vendor: vendor._id,
            type: 'loan_disbursement',
            amount: order.itemsPrice,
            description: `Escrow release for Order ${order._id} - Goods confirmed received`,
            status: 'success',
            orderId: order._id
        });

        res.json(updatedOrder);
    } catch (error) {
        next(error);
    }
};

// @desc    Mark Order as Completed (after repayment or admin action)
// @route   PUT /api/orders/:id/complete
// @access  Private (Retailer)
const updateOrderToCompleted = async (req, res, next) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        if (order.retailer.toString() !== req.user._id.toString()) {
            return res.status(401).json({ message: 'Not authorized' });
        }

        // Can only complete orders that have had goods received
        if (order.status !== 'goods_received') {
            return res.status(400).json({ message: 'Order must have goods received first' });
        }

        order.status = 'completed';
        const updatedOrder = await order.save();
        res.json(updatedOrder);
    } catch (error) {
        next(error);
    }
};

// @desc    Get My Orders
// @route   GET /api/orders/myorders
// @access  Private
const getMyOrders = async (req, res, next) => {
    try {
        let orders;
        if (req.user.role === 'retailer') {
            orders = await Order.find({ retailer: req.user._id }).sort({ createdAt: -1 });
        } else if (req.user.role === 'vendor' || req.userType === 'vendor') {
            orders = await Order.find({ vendor: req.user._id }).sort({ createdAt: -1 });
        } else {
            orders = [];
        }
        res.json(orders);
    } catch (error) {
        next(error);
    }
};

// @desc    Cancel Order (Retailer cancels - handles both pending and confirmed orders)
// @route   PUT /api/orders/:id/cancel
// @access  Private (Retailer)
const cancelOrder = async (req, res, next) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        // Verify ownership
        if (order.retailer.toString() !== req.user._id.toString()) {
            return res.status(401).json({ message: 'Not authorized to cancel this order' });
        }

        // Block cancellation of orders where goods have been confirmed received
        if (['goods_received', 'completed', 'delivered', 'repaid'].includes(order.status)) {
            return res.status(400).json({ message: 'Cannot cancel order after goods have been received.' });
        }

        // Already cancelled
        if (order.status === 'cancelled') {
            return res.status(400).json({ message: 'Order is already cancelled.' });
        }

        // If order was confirmed (ready_for_pickup) but goods NOT yet received,
        // no financial reversal needed since payment hasn't happened yet (Escrow model)
        // Just cancel the order
        order.status = 'cancelled';
        const updatedOrder = await order.save();

        res.json({ 
            message: 'Order cancelled successfully', 
            order: updatedOrder
        });
    } catch (error) {
        next(error);
    }
};

module.exports = { addOrderItems, getOrderById, updateOrderToReady, confirmGoodsReceived, updateOrderToCompleted, getMyOrders, cancelOrder };
