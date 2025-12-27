const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../models/User'); // Adjust path as needed

dotenv.config(); // Defaults to .env in CWD (server)

const seedAdmin = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const adminExists = await User.findOne({ email: 'admin@amana.com' });

        if (!adminExists) {
            await User.create({
                name: 'Admin User',
                email: 'admin@amana.com',
                password: 'adminpassword', // Will be hashed by pre-save hook
                phone: '0000000000',
                role: 'admin',
                isProfileComplete: true
            });
        }
        process.exit();
    } catch (error) {
        console.error('Error seeding admin:', error);
        process.exit(1);
    }
};

seedAdmin();
