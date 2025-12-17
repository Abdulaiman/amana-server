const mongoose = require('mongoose');

const withdrawalRequestSchema = mongoose.Schema({
  vendor: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Vendor' },
  amount: { type: Number, required: true },
  
  bankDetailsSnapshot: {
    bankName: { type: String },
    accountNumber: { type: String },
    accountName: { type: String }
  },
  
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Admin User
  paidAt: { type: Date },
  adminNote: { type: String }

}, { timestamps: true });

const WithdrawalRequest = mongoose.model('WithdrawalRequest', withdrawalRequestSchema);
module.exports = WithdrawalRequest;
