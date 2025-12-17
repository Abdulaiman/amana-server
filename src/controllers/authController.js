const User = require('../models/User');
const Vendor = require('../models/Vendor');
const generateToken = require('../utils/generateToken');

// @desc    Auth User (Retailer) & Get Token
// @route   POST /api/auth/login
// @access  Public
const authUser = async (req, res) => {
  const { email, password } = req.body;

  // Check Retailer DB
  const user = await User.findOne({ email });

  if (user && (await user.matchPassword(password))) {
    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken(user._id, user.role),
    });
  } else {
    // Check Vendor DB if not found in User DB
    const vendor = await Vendor.findOne({ email });
    
    if (vendor && (await vendor.matchPassword(password))) {
        res.json({
            _id: vendor._id,
            businessName: vendor.businessName,
            email: vendor.email,
            role: 'vendor', // Explicit role
            token: generateToken(vendor._id, 'vendor'),
        });
    } else {
        res.status(401);
        throw new Error('Invalid email or password');
    }
  }
};

// @desc    Register a new Retailer
// @route   POST /api/auth/register
// @access  Public
const registerUser = async (req, res) => {
  const { name, email, password, phone } = req.body;

  const userExists = await User.findOne({ email });

  if (userExists) {
    res.status(400);
    throw new Error('User already exists');
  }

  const user = await User.create({
    name,
    email,
    password,
    phone
  });

  if (user) {
    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: 'retailer',
      token: generateToken(user._id, 'retailer'),
    });
  } else {
    res.status(400);
    throw new Error('Invalid user data');
  }
};

// @desc    Register a new Vendor
// @route   POST /api/auth/register-vendor
// @access  Public
const registerVendor = async (req, res) => {
    const { businessName, email, password, phones, address, description } = req.body;
  
    const vendorExists = await Vendor.findOne({ email });
  
    if (vendorExists) {
      res.status(400);
      throw new Error('Vendor already exists');
    }
  
    // Ensure phones is an array
    const phoneArray = Array.isArray(phones) ? phones : [phones];

    const vendor = await Vendor.create({
      businessName,
      email,
      password,
      phones: phoneArray,
      address,
      description
    });
  
    if (vendor) {
      res.status(201).json({
        _id: vendor._id,
        businessName: vendor.businessName,
        email: vendor.email,
        role: 'vendor',
        token: generateToken(vendor._id, 'vendor'),
      });
    } else {
      res.status(400);
      throw new Error('Invalid vendor data');
    }
  };

module.exports = { authUser, registerUser, registerVendor };
