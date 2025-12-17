const Order = require('../models/Order');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const Vendor = require('../models/Vendor');

// @desc    Get All Transactions (Admin)
// @route   GET /api/transactions/admin
// @access  Private (Admin)
const getAllTransactions = async (req, res) => {
    try {
        // Fetch all orders (Earnings/Credits for vendors)
        const orders = await Order.find({})
            .populate('vendor', 'businessName')
            .populate('retailer', 'name')
            .sort({ createdAt: -1 });

        // Fetch all withdrawals (Debits/Payouts)
        const withdrawals = await WithdrawalRequest.find({})
            .populate('vendor', 'businessName')
            .populate('approvedBy', 'name')
            .sort({ createdAt: -1 });

        // Normalize and merge
        const standardizedOrders = orders.map(order => ({
            _id: order._id,
            type: 'order_payment',
            amount: order.itemsPrice, // Vendor earns the base price
            status: order.status === 'delivered' ? 'completed' : order.status,
            date: order.createdAt,
            description: `Order #${order._id.toString().slice(-6)} from ${order.retailer?.name || 'Retailer'}`,
            reference: order._id,
            user: order.vendor // The beneficiary
        }));

        const standardizedWithdrawals = withdrawals.map(withdrawal => ({
            _id: withdrawal._id,
            type: 'payout',
            amount: withdrawal.amount,
            status: withdrawal.status,
            date: withdrawal.createdAt,
            description: `Payout Request to ${withdrawal.bankDetailsSnapshot?.bankName || 'Bank'}`,
            reference: withdrawal._id,
            user: withdrawal.vendor
        }));

        const allTransactions = [...standardizedOrders, ...standardizedWithdrawals]
            .sort((a, b) => new Date(b.date) - new Date(a.date));

        // Calculate Analytics
        const totalVolume = standardizedOrders.reduce((acc, curr) => acc + curr.amount, 0);
        const totalPayouts = standardizedWithdrawals
            .filter(w => w.status === 'approved')
            .reduce((acc, curr) => acc + curr.amount, 0);
        const pendingPayoutsVolume = standardizedWithdrawals
            .filter(w => w.status === 'pending')
            .reduce((acc, curr) => acc + curr.amount, 0);

        res.json({
            transactions: allTransactions,
            analytics: {
                totalVolume,
                totalPayouts,
                pendingPayoutsVolume,
                count: allTransactions.length
            }
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get Vendor Transactions
// @route   GET /api/transactions/vendor
// @access  Private (Vendor)
const getVendorTransactions = async (req, res) => {
    try {
        const vendorId = req.user._id;

        // Fetch Vendor Orders
        const orders = await Order.find({ vendor: vendorId })
            .populate('retailer', 'name')
            .sort({ createdAt: -1 });

        // Fetch Vendor Withdrawals
        const withdrawals = await WithdrawalRequest.find({ vendor: vendorId })
            .sort({ createdAt: -1 });

        // Normalize
        const standardizedOrders = orders.map(order => ({
            _id: order._id,
            type: 'earning',
            amount: order.itemsPrice,
            status: 'completed', // For financial view, if order exists, it's a potential earning. 
            // NOTE: In real-world, might wait for 'delivered' status to call it 'completed' earning.
            // For now, list all orders.
            date: order.createdAt,
            description: `Order #${order._id.toString().slice(-6)}`,
            reference: order._id,
            isCredit: true
        }));

        const standardizedWithdrawals = withdrawals.map(withdrawal => ({
            _id: withdrawal._id,
            type: 'payout',
            amount: withdrawal.amount,
            status: withdrawal.status,
            date: withdrawal.createdAt,
            description: `Withdrawal to ${withdrawal.bankDetailsSnapshot?.bankName}`,
            reference: withdrawal._id,
            isCredit: false
        }));

        const allTransactions = [...standardizedOrders, ...standardizedWithdrawals]
            .sort((a, b) => new Date(b.date) - new Date(a.date));

        res.json(allTransactions);

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getAllTransactions,
    getVendorTransactions
};
