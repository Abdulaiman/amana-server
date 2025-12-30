const mongoose = require('mongoose');

const agentPurchaseSchema = mongoose.Schema({
  // Parties
  agent: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  retailer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Admin who approved
  
  // Product (captured once by agent, reused for receipt)
  productName: { type: String, required: true },
  productDescription: { type: String },
  quantity: { type: Number, default: 1 },
  productPhotos: [{ type: String }], // 1-10 Cloudinary URLs
  
  // Seller Info
  sellerName: { type: String },
  sellerPhone: { type: String },
  sellerLocation: { type: String },
  
  // Financials
  purchasePrice: { type: Number, required: true },
  repaymentTerm: { type: Number, enum: [3, 7, 14], default: 14 },
  markupPercentage: { type: Number },
  markupAmount: { type: Number },
  totalRetailerCost: { type: Number },
  
  // Disbursement (set when admin approves)
  disbursedAmount: { type: Number },
  disbursementMethod: { type: String, enum: ['bank_transfer', 'cash', 'mobile_money'] },
  disbursementReference: { type: String },
  
  // Status Flow
  status: { 
    type: String, 
    enum: [
      'draft',                      // Agent created, not yet linked
      'awaiting_retailer_confirm',  // Credit check passed, waiting for retailer
      'pending_admin_approval',     // Retailer confirmed, waiting for admin
      'fund_disbursed',             // Admin approved, agent has 1hr
      'delivered',                  // Agent delivered to retailer
      'received',                   // Retailer confirmed receipt
      'completed',                  // Repaid
      'expired',                    // 1hr timeout
      'declined',                   // Admin or retailer declined
      'disputed'                    // Issue raised
    ],
    default: 'draft'
  },
  declineReason: { type: String },
  
  // Security
  pickupCode: { type: String }, // 6-digit OTP for receipt confirmation
  
  // Timer for 1-hour window
  fundDisbursedAt: { type: Date },
  expiresAt: { type: Date },
  
  // Key Timestamps
  retailerConfirmedAt: { type: Date },
  adminApprovedAt: { type: Date },
  deliveredAt: { type: Date },
  receivedAt: { type: Date },
  dueDate: { type: Date },
  paidAt: { type: Date },
  
  // Repayment tracking (mirrors Order model)
  isPaid: { type: Boolean, default: false }

}, { timestamps: true });

// Generate 6-digit OTP
agentPurchaseSchema.methods.generatePickupCode = function() {
  this.pickupCode = Math.floor(100000 + Math.random() * 900000).toString();
  return this.pickupCode;
};

const AgentPurchase = mongoose.model('AgentPurchase', agentPurchaseSchema);
module.exports = AgentPurchase;
