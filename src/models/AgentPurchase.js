const mongoose = require('mongoose');

const agentPurchaseSchema = mongoose.Schema({
  // Parties
  agent: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  retailer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Admin who approved
  
  // Product (captured once by agent, reused for receipt)
  productName: { type: String, required: true },
  productDescription: { type: String },
  productPhotos: [{ type: String }], // 1-10 Cloudinary URLs
  
  // Seller Info
  sellerName: { type: String },
  sellerPhone: { type: String },
  sellerLocation: { type: String },
  
  // Financials
  purchasePrice: { type: Number, required: true },
  repaymentTerm: { type: Number, enum: [3, 7, 14] },
  markupPercentage: { type: Number },
  markupAmount: { type: Number },
  totalRetailerCost: { type: Number },
  
  // Duration (agent requested, admin can adjust)
  requestedDuration: { type: Number },           // Hours requested by agent
  adminAdjustedDuration: { type: Number },       // Hours set by admin (overrides requested)
  
  // Disbursement (set when admin approves)
  disbursedAmount: { type: Number },
  disbursementMethod: { type: String, enum: ['bank_transfer', 'cash', 'mobile_money'] },
  disbursementReference: { type: String },
  
  // Status Flow
  status: { 
    type: String, 
    enum: [
      'draft',                      // Agent created, not yet linked
      'awaiting_retailer_confirm',  // Credit check passed, waiting for retailer to express interest
      'pending_admin_approval',     // Retailer expressed interest, waiting for admin approval
      'fund_disbursed',             // Admin approved, funds sent to agent
      'pending_murabaha_acceptance',// Agent bought goods, sent Murabaha sale offer to retailer
      'murabaha_accepted',          // Retailer accepted the Murabaha sale terms
      'delivered',                  // Agent delivered to retailer
      'received',                   // Retailer confirmed receipt
      'completed',                  // Repaid
      'expired',                    // Duration timeout
      'declined',                   // Admin or retailer declined
      'cancelled',                  // Cancelled by agent (before payment) or admin (after refund)
      'cancellation_requested',     // Agent requested cancellation after payment, awaiting admin
      'disputed'                    // Issue raised
    ],
    default: 'draft'
  },
  declineReason: { type: String },

  // Cancellation / Refund
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  cancelledAt: { type: Date },
  cancelReason: { type: String },
  refundProofUrl: { type: String },           // Receipt/evidence of agent returning cash
  cashReturnConfirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  cashReturnConfirmedAt: { type: Date },
  
  // Security
  pickupCode: { type: String }, // 6-digit OTP for receipt confirmation
  
  // Proxy Actions (Agent-led overrides)
  proxyConfirmation: { type: Boolean, default: false }, // Agent confirmed for Retailer
  proxyReceipt: { type: Boolean, default: false }, // Agent confirmed delivery for Retailer
  proxyMurabahaAcceptance: { type: Boolean, default: false }, // Agent accepted Murabaha on retailer's behalf
  proxyProofUrl: { type: String }, // Photo proof for proxy actions

  
  // Timer for 1-hour window
  fundDisbursedAt: { type: Date },
  expiresAt: { type: Date },
  
  // Key Timestamps
  retailerConfirmedAt: { type: Date },
  adminApprovedAt: { type: Date },
  murabahaOfferSentAt: { type: Date },
  murabahaAcceptedAt: { type: Date },
  deliveredAt: { type: Date },
  receivedAt: { type: Date },
  dueDate: { type: Date },
  paidAt: { type: Date },
  
  // Repayment tracking (mirrors Order model)
  isPaid: { type: Boolean, default: false }

}, { timestamps: true });

// Compound index for atomic dedup of draft/awaiting AAPs
agentPurchaseSchema.index(
  { agent: 1, productName: 1, purchasePrice: 1, createdAt: -1 },
  { partialFilterExpression: { status: { $in: ['draft', 'awaiting_retailer_confirm'] } } }
);

// Generate 6-digit OTP
agentPurchaseSchema.methods.generatePickupCode = function() {
  this.pickupCode = Math.floor(100000 + Math.random() * 900000).toString();
  return this.pickupCode;
};

const AgentPurchase = mongoose.model('AgentPurchase', agentPurchaseSchema);
module.exports = AgentPurchase;
