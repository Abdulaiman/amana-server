/**
 * AAP Expiry Checker
 * Checks for agent purchases that have exceeded their duration window
 * and marks them as expired + notifies admin.
 * 
 * Run this as a cron job every 5 minutes:
 * In production, use node-cron or a scheduled task.
 */

const AgentPurchase = require('../models/AgentPurchase');
const User = require('../models/User');
const sendEmail = require('./emailService');

const checkExpiredAAPs = async () => {
    try {
        const now = new Date();

        // Find all AAPs where status requires action and expiresAt < now
        const expiredAAPs = await AgentPurchase.find({
            status: { $in: ['fund_disbursed', 'pending_murabaha_acceptance', 'murabaha_accepted'] },
            expiresAt: { $lt: now }
        }).populate('agent', 'name phone email')
          .populate('retailer', 'name phone');

        if (expiredAAPs.length === 0) {
            console.log('[AAP Expiry Check] No expired purchases found.');
            return { expired: 0 };
        }

        console.log(`[AAP Expiry Check] Found ${expiredAAPs.length} expired purchases.`);

        // Update each to 'expired'
        for (const aap of expiredAAPs) {
            aap.status = 'expired';
            await aap.save();

            console.log(`[AAP Expiry Check] Marked AAP ${aap._id} (${aap.productName}) as expired. Previous status: ${aap.status}`);
        }

        // Notify admin(s) via email
        const admins = await User.find({ role: 'admin' }).select('email name');
        
        if (admins.length > 0) {
            const subject = `⚠️ Alert: ${expiredAAPs.length} Agent Purchase(s) Expired`;
            
            const expiredList = expiredAAPs.map(aap => 
                `- ${aap.productName} (₦${aap.purchasePrice}) - Status: ${aap.status} - Agent: ${aap.agent?.name || 'Unknown'}, Retailer: ${aap.retailer?.name || 'Unknown'}`
            ).join('\n');

            const message = `
The following Agent-Assisted Purchases have exceeded their duration window without completion:

${expiredList}

Please review these in the Admin Dashboard and take appropriate action.

--- Amana System
            `;

            for (const admin of admins) {
                try {
                    await sendEmail({
                        email: admin.email,
                        subject,
                        message
                    });
                    console.log(`[AAP Expiry Check] Notified admin: ${admin.email}`);
                } catch (emailErr) {
                    console.error(`[AAP Expiry Check] Failed to email ${admin.email}:`, emailErr.message);
                }
            }
        }

        return { expired: expiredAAPs.length };
    } catch (error) {
        console.error('[AAP Expiry Check] Error:', error);
        throw error;
    }
};

module.exports = { checkExpiredAAPs };
