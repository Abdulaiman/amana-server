const axios = require('axios');
const User = require('../models/User');
const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const { calculateScoreGrowth, determineCreditLimit, determineTier } = require('../utils/amanaEngine');

/**
 * Internal: Core logic to update DB after successful Paystack verification
 */
const processPaymentUpdate = async (data, reference) => {
    // 0. IDEMPOTENCY CHECK
    const existingTx = await Transaction.findOne({ reference });
    if (existingTx) {
        console.log(`Duplicate verify call for ${reference}. Skipping DB updates.`);
        return { 
            alreadyProcessed: true, 
            amountPaid: existingTx.amount,
            status: 'success'
        };
    }

    const amountPaid = data.amount / 100; // Convert Kobo to Naira
    const email = data.customer.email;
    const metadata = data.metadata || {};

    // Find User
    let user;
    if (metadata.userId) {
        user = await User.findById(metadata.userId);
    }
    if (!user) {
        user = await User.findOne({ email });
    }
    if (!user) {
        throw new Error('User not found for this payment');
    }

    // Process Repayment Logic
    let remainingPayment = amountPaid;
    let ordersRepaidCount = 0;
    let ordersToProcess = [];

    if (metadata.orderId) {
        const specificOrder = await Order.findOne({ 
            _id: metadata.orderId, 
            retailer: user._id,
            isPaid: false
        });
        if (specificOrder) ordersToProcess.push(specificOrder);
    } else {
        const query = { 
            retailer: user._id, 
            status: { $in: ['ready_for_pickup', 'goods_received', 'completed', 'defaulted'] }, 
            isPaid: false 
        };
        const otherOrders = await Order.find(query).sort({ dueDate: 1 });
        ordersToProcess = otherOrders;
    }

    for (const order of ordersToProcess) {
        if (remainingPayment <= 0.5) break;
        if (remainingPayment >= (order.totalRepaymentAmount - 0.5)) { 
            order.status = 'repaid';
            order.isPaid = true;
            order.repaymentDate = new Date();
            await order.save();
            remainingPayment -= order.totalRepaymentAmount;
            ordersRepaidCount++;
        }
    }

    // Update User Credit
    user.usedCredit -= amountPaid;
    if (user.usedCredit < 0) user.usedCredit = 0;

    // AMANA GROWTH ENGINE
    if (amountPaid > 5000) {
        user.repaymentStreak = (user.repaymentStreak || 0) + 1;
        user.totalRepaid = (user.totalRepaid || 0) + amountPaid;
        user.amanaScore = calculateScoreGrowth(user.amanaScore, { streak: user.repaymentStreak });
        user.creditLimit = determineCreditLimit(user.amanaScore);
        user.tier = determineTier(user.amanaScore);
    }
    await user.save();

    // Log Transaction
    await Transaction.create({
        user: user._id,
        type: 'repayment',
        amount: amountPaid,
        description: `Repayment: ₦${amountPaid}. Score: ${user.amanaScore} (${user.tier}).`,
        status: 'success',
        reference: reference,
        orderId: metadata.orderId || null 
    });

    return {
        alreadyProcessed: false,
        amountPaid,
        user,
        ordersRepaidCount
    };
};

// @desc    Initialize Paystack Transaction
// @route   POST /api/payment/initialize
// @access  Private
const initializePayment = async (req, res) => {
    try {
        const { amount, email, orderId, callbackUrl, appPrefix } = req.body;

        const defaultCallback = req.headers.referer 
            ? `${new URL(req.headers.referer).origin}/payment/callback`
            : 'https://joinamana.com/payment/callback';

        const finalCallback = callbackUrl || defaultCallback;

        const params = {
            email,
            amount: amount * 100,
            callback_url: finalCallback,
            metadata: {
                userId: req.user._id.toString(),
                orderId: orderId || null,
                appPrefix: appPrefix || 'amana://'
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
        if (!reference) return res.status(400).json({ message: 'No reference provided' });

        const config = { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } };
        const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, config);
        const data = response.data.data;

        if (data.status === 'success') {
            const result = await processPaymentUpdate(data, reference);
            
            if (result.alreadyProcessed) {
                return res.json({
                    message: 'Payment already processed',
                    status: 'success',
                    amountPaid: result.amountPaid,
                    reference: reference
                });
            }

            res.json({ 
                status: 'success', 
                message: 'Payment verified! Trust Score updated.', 
                amountPaid: result.amountPaid,
                newLimit: result.user.creditLimit,
                newScore: result.user.amanaScore,
                newTier: result.user.tier,
                ordersRepaid: result.ordersRepaidCount
            });
        } else {
            res.status(400).json({ message: 'Payment verification failed at Paystack' });
        }
    } catch (error) {
        console.error('Paystack Verify Error:', error.message);
        res.status(500).json({ message: error.message || 'Payment verification failed' });
    }
};

// @desc    Verify Paystack & Show Handoff Page for Mobile App
// @route   GET /api/payment/verify-redirect
// @access  Public
const verifyPaymentAndRedirect = async (req, res) => {
    try {
        const { reference } = req.query;
        if (!reference) return res.status(400).send('No reference provided');

        const response = await axios.get(
            `https://api.paystack.co/transaction/verify/${reference}`,
            { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
        );

        const data = response.data.data;
        const appPrefix = data.metadata?.appPrefix || 'amana://';
        let status = 'failed';

        if (data.status === 'success') {
            try {
                await processPaymentUpdate(data, reference);
                status = 'success';
            } catch (err) {
                console.error('Process Payment Update Error:', err.message);
            }
        }

        const returnUrl = `${appPrefix}payment/callback?reference=${reference}&status=${status}`;

        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Amana Payment Verification</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background-color: #0a0a0a; color: white; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; text-align: center; }
                    .card { max-width: 400px; padding: 2rem; border-radius: 20px; background: #111; box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 1px solid #222; }
                    .icon { width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem; background: ${status === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; color: ${status === 'success' ? '#10b981' : '#ef4444'}; font-size: 32px; font-weight: bold; }
                    h2 { font-size: 1.5rem; margin-bottom: 0.5rem; }
                    p { color: #888; margin-bottom: 2rem; line-height: 1.5; }
                    .btn { display: block; width: 100%; padding: 1rem; border-radius: 12px; background: #10b981; color: white; text-decoration: none; font-weight: bold; font-size: 1.1rem; border: none; cursor: pointer; transition: transform 0.2s; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.3); }
                    .btn:active { transform: scale(0.98); }
                    .footer { font-size: 0.8rem; margin-top: 1.5rem; color: #555; }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="icon">${status === 'success' ? '✓' : '✕'}</div>
                    <h2>Payment ${status === 'success' ? 'Successful' : 'Verification Failed'}</h2>
                    <p>
                        ${status === 'success' ? 'Great! Your payment has been confirmed and your credit balance updated.' : 'We could not confirm your payment yet.'}
                        <br/>Tap the button below to return to the Amana app.
                    </p>
                    <a href="${returnUrl}" class="btn">Return to Amana App</a>
                    <div class="footer">Reference: ${reference.slice(-8).toUpperCase()}</div>
                </div>
                <script>
                    setTimeout(() => {
                        window.location.href = "${returnUrl}";
                    }, 3000);
                </script>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Verify Redirect Error:', error.message);
        res.status(500).send('Error during verification. Please contact support.');
    }
};

module.exports = { initializePayment, verifyPayment, verifyPaymentAndRedirect };
