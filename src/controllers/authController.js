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
    // Check if vendor profile exists but isn't linked yet
    if (!user.linkedProfileId) {
      const vendor = await Vendor.findOne({ email });
      if (vendor) {
        user.linkedProfileId = vendor._id;
        await user.save();
        vendor.linkedProfileId = user._id;
        await vendor.save();
      }
    }

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role, // This will be 'retailer' or 'admin'
      hasOtherRole: !!user.linkedProfileId,
      hasTakenTest: user.hasTakenTest,
      amanaScore: user.amanaScore,
      verificationStatus: user.verificationStatus,
      isProfileComplete: user.isProfileComplete,
      kyc: user.kyc,
      isAgent: user.isAgent,
      linkedProfileId: user.linkedProfileId,
      token: generateToken(user._id, user.role),
    });
  } else {
    // Check Vendor DB if not found in User DB
    const vendor = await Vendor.findOne({ email });
    
    if (vendor && (await vendor.matchPassword(password))) {
        // Check if user profile exists but isn't linked yet
        if (!vendor.linkedProfileId) {
          const user = await User.findOne({ email });
          if (user) {
            vendor.linkedProfileId = user._id;
            await vendor.save();
            user.linkedProfileId = vendor._id;
            await user.save();
          }
        }

        res.json({
            _id: vendor._id,
            businessName: vendor.businessName,
            email: vendor.email,
            role: 'vendor',
            hasOtherRole: !!vendor.linkedProfileId,
            verificationStatus: vendor.verificationStatus,
            isProfileComplete: vendor.isProfileComplete,
            isVerified: vendor.isVerified,
            linkedProfileId: vendor.linkedProfileId,
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

  let finalPassword = password;
  
  // Linkage Logic: If password not provided, try to copy from Vendor profile (dual role case)
  if (!finalPassword) {
     const vendor = await Vendor.findOne({ email });
     if (vendor) {
        finalPassword = vendor.password; // This will be the hashed password
     } else {
        res.status(400);
        throw new Error('Password is required for new registration');
     }
  }

  const user = await User.create({
    name,
    email,
    password: finalPassword,
    phone
  });

  if (user) {
    // Check if vendor profile exists and link
    const vendor = await Vendor.findOne({ email });
    if (vendor) {
      user.linkedProfileId = vendor._id;
      await user.save();
      vendor.linkedProfileId = user._id;
      await vendor.save();
    }

    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: 'retailer',
      hasOtherRole: !!user.linkedProfileId,
      hasTakenTest: user.hasTakenTest,
      amanaScore: user.amanaScore,
      verificationStatus: user.verificationStatus,
      isProfileComplete: user.isProfileComplete,
      kyc: user.kyc,
      isAgent: user.isAgent,
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

    let finalPassword = password;

    // Linkage Logic: If password not provided, try to copy from Retailer profile (dual role case)
    if (!finalPassword) {
      const user = await User.findOne({ email });
      if (user) {
         finalPassword = user.password; // This will be the hashed password
      } else {
         res.status(400);
         throw new Error('Password is required for new registration');
      }
    }
  
    // Ensure phones is an array
    const phoneArray = Array.isArray(phones) ? phones : [phones];

    const vendor = await Vendor.create({
      businessName,
      email,
      password: finalPassword,
      phones: phoneArray,
      address,
      description
    });
  
    if (vendor) {
      // Check if user profile exists and link
      const user = await User.findOne({ email });
      if (user) {
        vendor.linkedProfileId = user._id;
        await vendor.save();
        user.linkedProfileId = vendor._id;
        await user.save();
      }

      res.status(201).json({
        _id: vendor._id,
        businessName: vendor.businessName,
        email: vendor.email,
        role: 'vendor',
        hasOtherRole: !!vendor.linkedProfileId,
        verificationStatus: vendor.verificationStatus,
        isProfileComplete: vendor.isProfileComplete,
        isVerified: vendor.isVerified,
        linkedProfileId: vendor.linkedProfileId,
        token: generateToken(vendor._id, 'vendor'),
      });
    } else {
      res.status(400);
      throw new Error('Invalid vendor data');
    }
  };

// @desc    Switch Profile Role
// @route   POST /api/auth/switch-role
// @access  Private
const switchProfile = async (req, res) => {
  const email = req.user.email;
  const currentRole = req.userType;

  if (currentRole === 'vendor') {
    // Switch to Retailer
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'Retailer profile not found' });
    }
    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      hasOtherRole: true,
      hasTakenTest: user.hasTakenTest,
      amanaScore: user.amanaScore,
      verificationStatus: user.verificationStatus,
      isProfileComplete: user.isProfileComplete,
      kyc: user.kyc,
      isAgent: user.isAgent,
      linkedProfileId: user.linkedProfileId,
      token: generateToken(user._id, user.role),
    });
  } else {
    // Switch to Vendor
    const vendor = await Vendor.findOne({ email });
    if (!vendor) {
      return res.status(404).json({ message: 'Vendor profile not found' });
    }
    res.json({
      _id: vendor._id,
      businessName: vendor.businessName,
      email: vendor.email,
      role: 'vendor',
      hasOtherRole: true,
      verificationStatus: vendor.verificationStatus,
      isProfileComplete: vendor.isProfileComplete,
      isVerified: vendor.isVerified,
      token: generateToken(vendor._id, 'vendor'),
    });
  }
};

module.exports = { authUser, registerUser, registerVendor, switchProfile };
