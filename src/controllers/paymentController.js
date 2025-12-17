const axios = require('axios');
const User = require('../models/User');
const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const { calculateScoreGrowth, determineCreditLimit, determineTier } = require('../utils/amanaEngine');

// @desc    Initialize Paystack Transaction
// @route   POST /api/payment/initialize
// @access  Private
const initializePayment = async (req, res) => {
    try {
        const { amount, email, orderId } = req.body; // Amount in Naira

        const params = {
            email,
            amount: amount * 100, // Convert to Kobo
            callback_url: 'http://localhost:5173/payment/callback',
            metadata: {
                userId: req.user._id,
                orderId: orderId || null // Optional: specific order to repay
            }
        };

        const config = {
            headers: {
                Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json'
            }
        };

        const response = await axios.post('https://api.paystack.co/transaction/initialize', params, config);

        res.json(response.data.data);
    } catch (error) {
        console.error('Paystack Init Error:', error.response?.data || error.message);
        res.status(500).json({ message: 'Payment initialization failed' });
    }
};

// @desc    Verify Paystack Transaction & Process Repayment
// @route   GET /api/payment/verify
// @access  Private
const verifyPayment = async (req, res) => {
    try {
        const { reference } = req.query;

        if (!reference) {
            return res.status(400).json({ message: 'No reference provided' });
        }

        // 0. IDEMPOTENCY CHECK
        // If transaction already exists, return early to prevent double credit deduction.
        const existingTx = await Transaction.findOne({ reference });
        if (existingTx) {
            console.log(`Duplicate verify call for ${reference}. Skipping.`);
            return res.status(200).json({
                message: 'Payment already processed',
                status: 'success',
                amountPaid: existingTx.amount,
                reference: reference
            });
        }

        const config = {
            headers: {
                Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
            }
        };

        // 1. Verify with Paystack
        const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, config);
        const data = response.data.data;

        if (data.status === 'success') {
            const amountPaid = data.amount / 100; // Convert Kobo to Naira
            const email = data.customer.email;
            const metadata = data.metadata || {};

            // 2. Find User
            const user = await User.findOne({ email });
            if (!user) {
                return res.status(404).json({ message: 'User not found for this payment' });
            }

            // 3. Process Repayment Logic
            let remainingPayment = amountPaid;
            let ordersRepaidCount = 0;

            // Strategy: 
            // If orderId provided -> STRICTLY processing that order only.
            // If NO orderId -> FIFO (General Repayment).

            let ordersToProcess = [];
            console.log("Processing Payment Verification. Metadata:", metadata);

            // A. Check for Specific Order Target
            if (metadata.orderId) {
                console.log(`Targeting Specific Order ID: ${metadata.orderId}`);
                const specificOrder = await Order.findOne({ 
                    _id: metadata.orderId, 
                    retailer: user._id,
                    isPaid: false
                });
                
                if (specificOrder) {
                    ordersToProcess.push(specificOrder);
                } else {
                    console.log("Specific Order not found or already paid. Skipping specific processing.");
                }
                
                // CRITICAL FIX: Do NOT append otherOrders here. 
                // If user selected an order, we only pay that order.
                
            } else {
                // B. Fetch others for FIFO fallback (Only if NO specific target)
                console.log("No Order ID provided. Falling back to FIFO repayment.");
                const query = { 
                    retailer: user._id, 
                    status: { $in: ['ready_for_pickup', 'goods_received', 'completed', 'defaulted'] }, 
                    isPaid: false 
                };
                
                const otherOrders = await Order.find(query).sort({ dueDate: 1 });
                ordersToProcess = otherOrders;
            }

            // If specific order targeted, move it to front of array? Or handle separately.
            // Let's just handle everything in date order (FIFO) is safest financial logic for "General Repayment".
            // If checking specific "pay this order", user UI should ensure amount matches. 
            // Backend will just apply funds intelligently.

            for (const order of ordersToProcess) {
                if (remainingPayment <= 0.5) break; // Float tolerance

                // Logic: 
                // We mark 'repaid' if incoming payment covers the TOTAL due for this order.
                // Using a small tolerance (0.5) for floating point math.
                
                if (remainingPayment >= (order.totalRepaymentAmount - 0.5)) { 
                    order.status = 'repaid';
                    order.isPaid = true;
                    order.repaymentDate = new Date();
                    await order.save();
                    
                    remainingPayment -= order.totalRepaymentAmount;
                    ordersRepaidCount++;
                }
            }

            // 4. Update User Credit (Reduce Debt)
            user.usedCredit -= amountPaid;
            if (user.usedCredit < 0) user.usedCredit = 0;

            // 5. AMANA GROWTH ENGINE 🚀
            // Identify if this is a "Good" repayment (e.g. significant amount, not just ₦1)
            // For MVP, we count every repayment > ₦5000 as a streak builder
            if (amountPaid > 5000) {
                user.repaymentStreak = (user.repaymentStreak || 0) + 1;
                user.totalRepaid = (user.totalRepaid || 0) + amountPaid;

                // Calculate New Score
                const oldScore = user.amanaScore;
                user.amanaScore = calculateScoreGrowth(user.amanaScore, { streak: user.repaymentStreak });

                // Recalculate Limit & Tier based on New Score
                user.creditLimit = determineCreditLimit(user.amanaScore);
                user.tier = determineTier(user.amanaScore);
            }
            
            await user.save();

            // 6. Log Transaction
            await Transaction.create({
                user: user._id,
                type: 'repayment',
                amount: amountPaid,
                description: `Repayment: ₦${amountPaid}. Score: ${user.amanaScore} (${user.tier}).`,
                status: 'success',
                reference: reference,
                orderId: metadata.orderId || null 
            });

            res.json({ 
                status: 'success', 
                message: 'Payment verified! Trust Score updated.', 
                amountPaid,
                newLimit: user.creditLimit,
                newScore: user.amanaScore,
                newTier: user.tier,
                ordersRepaid: ordersRepaidCount
            });

        } else {
            res.status(400).json({ message: 'Payment verification failed at Paystack' });
        }

    } catch (error) {
        console.error('Paystack Verify Error:', error.response?.data || error.message);
        res.status(500).json({ message: 'Payment verification failed' });
    }
};

module.exports = { initializePayment, verifyPayment };
