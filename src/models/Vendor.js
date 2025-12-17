const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const vendorSchema = mongoose.Schema({
  businessName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  description: { type: String },
  address: { type: String, required: true },
  
  // Contact (2 phones required)
  phones: [{ type: String, required: true }], 
  
  // Owner Details (for KYC)
  ownerName: { type: String },
  ownerPhone: { type: String },
  profilePicUrl: { type: String },
  
  // Verification
  cacNumber: { type: String },
  cacDocumentUrl: { type: String }, // Cloudinary URL
  isVerified: { type: Boolean, default: false }, // Admin controlled
  verificationStatus: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
  
  // Profile Completion (like retailers)
  isProfileComplete: { type: Boolean, default: false },
  
  // Financials
  walletBalance: { type: Number, default: 0 }, // Withdrawable
  bankDetails: {
    bankName: { type: String },
    accountNumber: { type: String },
    accountName: { type: String }
  },

  // Reputation
  rating: { type: Number, default: 0 },
  numReviews: { type: Number, default: 0 },

}, { timestamps: true });

vendorSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

vendorSchema.pre('save', async function() {
  if (!this.isModified('password')) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

const Vendor = mongoose.model('Vendor', vendorSchema);
module.exports = Vendor;
