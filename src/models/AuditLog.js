const mongoose = require('mongoose');

const auditLogSchema = mongoose.Schema({
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, required: true }, // e.g., 'VERIFY_USER', 'BAN_USER', 'CREDIT_WALLET'
  targetId: { type: mongoose.Schema.Types.ObjectId }, // ID of the affected User/Order/Vendor
  targetType: { type: String }, // 'User', 'Vendor', 'Order'
  details: { type: Object }, // JSON dump of what changed (before/after or diff)
  ipAddress: { type: String },
  note: { type: String } // Optional context
}, { timestamps: true });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);
module.exports = AuditLog;
