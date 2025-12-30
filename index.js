const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const connectDB = require('./src/config/db');

// Load environment variables
dotenv.config();

// Connect to Database
connectDB();

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));
app.use(express.urlencoded({ extended: true }));

// Basic Routes
app.get('/', (req, res) => {
  res.send('Amana API is running...');
});

// Import Routes
const authRoutes = require('./src/routes/authRoutes');
app.use('/api/auth', authRoutes);

const retailerRoutes = require('./src/routes/retailerRoutes');
app.use('/api/retailer', retailerRoutes);

const vendorRoutes = require('./src/routes/vendorRoutes');
app.use('/api/vendor', vendorRoutes);

const productRoutes = require('./src/routes/productRoutes');
app.use('/api/products', productRoutes);

const orderRoutes = require('./src/routes/orderRoutes');
app.use('/api/orders', orderRoutes);

const adminRoutes = require('./src/routes/adminRoutes');
app.use('/api/admin', adminRoutes);

const uploadRoutes = require('./src/routes/uploadRoutes');
app.use('/api/upload', uploadRoutes);

const paymentRoutes = require('./src/routes/paymentRoutes');
app.use('/api/payment', paymentRoutes);

const transactionRoutes = require('./src/routes/transactionRoutes');
app.use('/api/transactions', transactionRoutes);

const agentPurchaseRoutes = require('./src/routes/agentPurchaseRoutes');
app.use('/api/aap', agentPurchaseRoutes);

// Static uploads folder
app.use('/uploads', express.static(path.join(__dirname, '/uploads')));

// Error Handling Middleware
app.use((err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  res.status(statusCode);
  res.json({
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});
