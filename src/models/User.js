const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phone: { type: String, required: true },
  address: { type: String },
  role: { type: String, default: 'retailer', enum: ['retailer', 'admin'] },
  
  // Identity & Verification (Sensitive - Locked after submit)
  kyc: {
    bvn: { type: String },
    nin: { type: String }, // Dedicated field for NIN
    idCardUrl: { type: String }, // Cloudinary URL
    locationProofUrl: { type: String }, // Cloudinary URL
    bankStatementUrl: { type: String }, // Added for PDF support
    profilePicUrl: { type: String }, 
    isKycSubmitted: { type: Boolean, default: false },
    isKycVerified: { type: Boolean, default: false } // Admin verify
  },

  isProfileComplete: { type: Boolean, default: false }, // Gatekeeper Flag
  verificationStatus: { 
    type: String, 
    enum: ['unsubmitted', 'pending', 'approved', 'rejected'], 
    default: 'unsubmitted' 
  },
  rejectionReason: { type: String },
  sensitiveDataLocked: { type: Boolean, default: false }, // Locks KYC fields after submission

  // Business Operations (Trust Signals)
  businessInfo: {
    businessName: { type: String },
    businessType: { type: String }, // e.g. Retail, FMCG
    yearsInBusiness: { type: Number },
    startingCapital: { type: String }, // Range e.g. "50k-100k"
    description: { type: String }
  },
  
  // Amana Engine Stats
  amanaScore: { type: Number, default: 0 }, // 0-100
  tier: { type: String, default: 'Bronze', enum: ['Bronze', 'Silver', 'Gold'] },
  
  creditLimit: { type: Number, default: 0 },
  walletBalance: { type: Number, default: 0 },
  usedCredit: { type: Number, default: 0 },
  markupTier: { type: Number, default: 5 }, // Percentage (e.g., 5%)
  
  // Growth Tracking
  repaymentStreak: { type: Number, default: 0 },
  totalRepaid: { type: Number, default: 0 },
  
  // Next of Kin
  nextOfKin: {
    name: { type: String },
    phone: { type: String },
    relationship: { type: String },
    address: { type: String }
  },

  // Onboarding (Psychometric)
  hasTakenTest: { type: Boolean, default: false },
  testScore: { type: Number },

  // Agent System (Murabaha Intermediary)
  isAgent: { type: Boolean, default: false },

  // Dual Role Linkage
  linkedProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' },

  // Admin Controls
  isActive: { type: Boolean, default: true }, // For banning
  adminNotes: [{
    content: String,
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
  }],

  // Password Reset
  resetPasswordToken: String,
  resetPasswordExpire: Date

}, { timestamps: true });

// Password Match
userSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Password Hash
userSchema.pre('save', async function() {
  if (!this.isModified('password')) {
    return;
  }
  
  // If password already looks like a bcrypt hash, don't re-hash
  if (this.password.startsWith('$2a$') || this.password.startsWith('$2b$')) {
    return;
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

const User = mongoose.model('User', userSchema);
module.exports = User;
