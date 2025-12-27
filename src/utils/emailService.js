const nodemailer = require('nodemailer');

const sendEmail = async ({ to, subject, text, html }) => {
    try {
        const transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 465,
            secure: true, // Use SSL/TLS
            pool: true,   // Efficiently reuse connections
            auth: {
                user: process.env.NODEMAILER_EMAIL,
                pass: process.env.NODEMAILER_PASSWORD
            },
            connectionTimeout: 10000, // 10 seconds timeout
            greetingTimeout: 10000,
            socketTimeout: 15000
        });

        const mailOptions = {
            from: `"Amana Support" <${process.env.NODEMAILER_EMAIL}>`,
            to,
            subject,
            text,
            html
        };

        const info = await transporter.sendMail(mailOptions);
        return info;
    } catch (error) {
        console.error('Error sending email:', error);
        throw error;
    }
};

module.exports = sendEmail;
