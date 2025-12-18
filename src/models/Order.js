const mongoose = require('mongoose');

const orderSchema = mongoose.Schema({
  retailer: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
  vendor: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Vendor' },
  
  orderItems: [
    {
      name: { type: String, required: true },
      qty: { type: Number, required: true },
      image: { type: String, required: true },
      price: { type: Number, required: true }, // Original price
      product: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Product' },
    }
  ],

  // Financials
  itemsPrice: { type: Number, required: true }, // Total cost of goods
  markupPercentage: { type: Number, required: true }, // e.g. 5
  markupAmount: { type: Number, required: true }, // Calculated markup
  totalRepaymentAmount: { type: Number, required: true }, // itemsPrice + markupAmount
  
  // Status flow
  status: { 
    type: String, 
    required: true, 
    default: 'pending_vendor',
    enum: [
        'pending_vendor', 
        'ready_for_pickup', 
        'vendor_settled', // Added for Agent Workflow
        'goods_received', 
        'completed', 
        'repaid', 
        'cancelled', 
        'defaulted'
    ] 
  },

  // Agent Assignment
  agent: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  agentAssignedAt: { type: Date },

  // Settlement Tracking
  isVendorSettled: { type: Boolean, default: false },
  vendorSettledAt: { type: Date },
  
  // Security
  pickupCode: { type: String }, // OTP generated for pickup
  goodsReceivedAt: { type: Date }, // When retailer confirmed receipt
  
  // Dates
  dueDate: { type: Date }, // Set when vendor confirms
  paidAt: { type: Date },
  repaymentDate: { type: Date }, // Actual date repaid
  isPaid: { type: Boolean, default: false }, // Repayment status

}, { timestamps: true });

const Order = mongoose.model('Order', orderSchema);
module.exports = Order;
