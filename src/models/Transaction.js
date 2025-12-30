const mongoose = require('mongoose');

const transactionSchema = mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Optional if vendor transaction
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' }, // Optional if user transaction
  
  type: { 
    type: String, 
    enum: [
      'loan_disbursement', 
      'repayment', 
      'vendor_payout', 
      'deposit', 
      'refund',
      'agent_fund_disbursement',  // Admin sends funds to agent for AAP
      'aap_credit_lock'           // Retailer's credit locked for AAP
    ], 
    required: true 
  },
  amount: { type: Number, required: true },
  description: { type: String },
  reference: { type: String }, // Paystack ref or internal ID
  status: { type: String, enum: ['pending', 'success', 'failed'], default: 'success' },
  
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  agentPurchaseId: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentPurchase' },


}, { timestamps: true });

const Transaction = mongoose.model('Transaction', transactionSchema);
module.exports = Transaction;
