const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Vendor = require('../models/Vendor');

const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      token = req.headers.authorization.split(' ')[1];

      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Check if user is Retailer or Vendor or Admin
      // We attach the user object to req.user regardless of type
      // Check User collection first
      let user = await User.findById(decoded.id).select('-password');
      
      if (!user) {
        // Check Vendor collection
        user = await Vendor.findById(decoded.id).select('-password');
        if(user) {
            req.userType = 'vendor';
        }
      } else {
          req.userType = user.role; // 'retailer' or 'admin'
      }

      req.user = user;

      if (!req.user) {
        return res.status(401).json({ message: 'Not authorized, user not found' });
      }

      // GLOBAL BAN ENFORCEMENT
      if (req.user.isActive === false) {
        return res.status(403).json({ message: 'Account Banned. Contact Support.' });
      }

      next();
    } catch (error) {
      console.error(error);
      return res.status(401).json({ message: 'Not authorized, token failed' });
    }
  } else {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }
};

const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(401);
    throw new Error('Not authorized as an admin');
  }
};

module.exports = { protect, admin };
