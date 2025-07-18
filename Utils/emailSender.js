const nodemailer = require('nodemailer');
require('dotenv').config();

const sendEmail = async (options) => {
    // 1. Creates a 'transporter'
    const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST || 'smtp.gmail.com',
        port: process.env.EMAIL_PORT || 587,
        secure: false,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
        tls: { rejectUnauthorized: false } // Important for some dev environments
    });

    // 2. Defines 'mailOptions'
    const mailOptions = {
        from: `${process.env.EMAIL_FROM_NAME || 'Your App'} <${process.env.EMAIL_USER}>`,
        to: options.email,     // The actual recipient's email address
        subject: options.subject, // The subject line of the email
        text: options.message, // Plain text content
        html: options.html,    // HTML content (for rich emails)
        replyTo: options.replyTo // Optional: allows recipient to reply directly to sender
    };

    // 3. Sends the email
    await transporter.sendMail(mailOptions);
    console.log(`Email sent to ${options.email} with subject: ${options.subject}`);
};

module.exports = sendEmail;