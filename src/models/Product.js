const mongoose = require('mongoose');

const productSchema = mongoose.Schema({
  vendor: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Vendor' },
  name: { type: String, required: true },
  description: { type: String, required: true },
  price: { type: Number, required: true, default: 0 },
  category: { type: String, required: true },
  images: [{ type: String }], // Cloudinary URLs
  countInStock: { type: Number, required: true, default: 0 },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

const Product = mongoose.model('Product', productSchema);
module.exports = Product;
