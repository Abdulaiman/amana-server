const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Vendor = require('../models/Vendor');
const generateToken = require('../utils/generateToken');
const sendEmail = require('../utils/emailService');

// @desc    Auth User (Retailer) & Get Token
// @route   POST /api/auth/login
// @access  Public
const authUser = async (req, res) => {
  const { email, password } = req.body;

  // Check Retailer DB
  const user = await User.findOne({ email });

  if (user && (await user.matchPassword(password))) {
    // Ban Check
    if (user.isActive === false) {
        res.status(403);
        throw new Error('This account has been banned. Please contact support.');
    }

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
      isActive: user.isActive,
      isBanned: user.isBanned,
      linkedProfileId: user.linkedProfileId,
      token: generateToken(user._id, user.role),
    });
  } else {
    // Check Vendor DB if not found in User DB
    const vendor = await Vendor.findOne({ email });
    
    if (vendor && (await vendor.matchPassword(password))) {
        // Ban Check
        if (vendor.isActive === false) {
            res.status(403);
            throw new Error('This account has been banned. Please contact support.');
        }

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
            isActive: vendor.isActive,
            isBanned: vendor.isBanned,
            linkedProfileId: vendor.linkedProfileId,
            token: generateToken(vendor._id, 'vendor'),
        });
    } else {
        res.status(401);
        throw new Error('Invalid email or password');
    }
  }
};

// ... (registerUser and registerVendor remain same, just update exports) ...

// @desc    Forgot Password
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = async (req, res) => {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
        res.status(404);
        throw new Error('User not found');
    }

    // Generate Token
    const resetToken = crypto.randomBytes(20).toString('hex');

    // Hash and set to resetPasswordToken field
    user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    // Set expire (10 mins)
    user.resetPasswordExpire = Date.now() + 10 * 60 * 1000;

    await user.save();

    // Create reset url (Points to PWA)
    const resetUrl = `https://amana-deployment-01.vercel.app/reset-password/${resetToken}`;
    // NOTE: In local dev this should be localhost.
    // Ideally use process.env.CLIENT_URL or dynamic host header.
    // For now assuming the user is editing the files on Desktop and probably viewing on local.
    // But since Mobile PWA link is needed...
    // Let's use a safe default or CLIENT_URL if exists.
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    const actualResetUrl = `${clientUrl}/reset-password/${resetToken}`;

    const message = `
      You are receiving this email because you (or someone else) has requested the reset of a password.
      Please make a PUT request to: \n\n ${actualResetUrl} \n\n
      (Or simply click the link if you are on the website).
      
      This link will expire in 10 minutes.
    `;

    try {
        await sendEmail({
            to: user.email,
            subject: 'Password Reset Token',
            text: message,
            html: `
                <h3>Password Reset Request</h3>
                <p>Click the button below to reset your password. This link is valid for 10 minutes.</p>
                <a href="${actualResetUrl}" style="background:#10b981; color:white; padding:10px 20px; text-decoration:none; border-radius:5px;">Reset Password</a>
                <p>Or copy this link: ${actualResetUrl}</p>
            `
        });

        res.status(200).json({ success: true, data: 'Email sent' });
    } catch (error) {
        console.error(error);
        user.resetPasswordToken = undefined;
        user.resetPasswordExpire = undefined;
        await user.save();
        res.status(500);
        throw new Error('Email could not be sent');
    }
};

// @desc    Reset Password
// @route   PUT /api/auth/reset-password/:resettoken
// @access  Public
const resetPassword = async (req, res) => {
    const resetPasswordToken = crypto.createHash('sha256').update(req.params.resettoken).digest('hex');

    const user = await User.findOne({
        resetPasswordToken,
        resetPasswordExpire: { $gt: Date.now() }
    });

    if (!user) {
        res.status(400);
        throw new Error('Invalid token');
    }

    // Set new password
    user.password = req.body.password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;

    await user.save();

    res.status(200).json({
        success: true,
        data: 'Password reset successful',
        token: generateToken(user._id, user.role) // Auto login?
    });
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
      isActive: user.isActive,
      isBanned: user.isBanned,
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
      isActive: vendor.isActive,
      isBanned: vendor.isBanned,
      token: generateToken(vendor._id, 'vendor'),
    });
  }
};

module.exports = { authUser, registerUser, registerVendor, switchProfile, forgotPassword, resetPassword };
