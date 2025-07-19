const SSLCommerzPayment = require('sslcommerz-lts');
const CustomError = require('../Utils/CustomError');
const asyncHandler = require('../Utils/asyncHandler');
const sendEmail = require('../Utils/emailSender');
const User = require('../Models/userSchema');
const { v4: uuidv4 } = require('uuid');

// Cache environment validation at startup
const requiredEnv = ['SSL_STORE_ID', 'SSL_STORE_PASSWORD', 'FRONTEND_URL', 'BACKEND_URL', 'ADMIN_EMAIL'];
const missingEnv = requiredEnv.filter(env => !process.env[env]);
if (missingEnv.length) {
    throw new Error(`Missing required environment variables: ${missingEnv.join(', ')}`);
}

class PaymentController {
    static CONFIG = {
        CURRENCY: 'BDT',
        COUNTRY: 'Bangladesh',
        DEFAULT_POSTCODE: '1000',
        PRODUCT_CATEGORY: 'Donation',
        PRODUCT_PROFILE: 'non-physical-goods',
        SHIPPING_METHOD: 'NO',
        EMI_OPTION: 0
    };

    static generateTransactionId() {
        return `TR${Date.now()}${uuidv4().slice(0, 8).toUpperCase()}`;
    }

    static initiatePayment = asyncHandler(async (req, res, next) => {
        const user = req.user;
        const { amount } = req.body;

        if (!user) {
            return next(new CustomError('User not authenticated.', 401));
        }
        if (!amount || typeof amount !== 'number' || amount <= 0) {
            return next(new CustomError('Please provide a valid donation amount.', 400));
        }

        const transactionId = this.generateTransactionId();
        const sslcz = new SSLCommerzPayment(
            process.env.SSL_STORE_ID,
            process.env.SSL_STORE_PASSWORD,
            false // Sandbox mode
        );

        const data = {
            total_amount: parseFloat(amount.toFixed(2)),
            currency: this.CONFIG.CURRENCY,
            tran_id: transactionId,
            success_url: `${process.env.BACKEND_URL}/api/payment/success?tran_id=${encodeURIComponent(transactionId)}`,
            fail_url: `${process.env.BACKEND_URL}/api/payment/fail`,
            cancel_url: `${process.env.BACKEND_URL}/api/payment/cancel`,
            ipn_url: `${process.env.BACKEND_URL}/api/payment/ipn`,
            product_category: this.CONFIG.PRODUCT_CATEGORY,
            product_name: `Donation by ${user.firstName} ${user.lastName}`,
            num_item: 1,
            product_profile: this.CONFIG.PRODUCT_PROFILE,
            cus_name: `${user.firstName} ${user.lastName}`,
            cus_email: user.email.toLowerCase(), // Normalize email
            cus_add1: user.address?.line1 || 'N/A',
            cus_add2: user.address?.line2 || 'N/A',
            cus_city: user.address?.city || 'N/A',
            cus_state: user.address?.state || 'N/A',
            cus_postcode: user.address?.zip || this.CONFIG.DEFAULT_POSTCODE,
            cus_country: this.CONFIG.COUNTRY,
            cus_phone: user.phone ? String(user.phone) : 'N/A',
            cus_fax: 'N/A',
            shipping_method: this.CONFIG.SHIPPING_METHOD,
            ship_name: `${user.firstName} ${user.lastName}`,
            ship_add1: user.address?.line1 || 'N/A',
            ship_add2: user.address?.line2 || 'N/A',
            ship_city: user.address?.city || 'N/A',
            ship_state: user.address?.state || 'N/A',
            ship_postcode: user.address?.zip || this.CONFIG.DEFAULT_POSTCODE,
            ship_country: this.CONFIG.COUNTRY,
            emi_option: this.CONFIG.EMI_OPTION
        };

        try {
            const apiResponse = await sslcz.init(data);
            if (apiResponse.GatewayPageURL) {
                return res.status(200).json({
                    success: true,
                    message: 'Redirecting to SSLCommerz gateway...',
                    gatewayUrl: apiResponse.GatewayPageURL,
                    transactionId
                });
            }
            return next(new CustomError('Failed to initiate payment. No Gateway URL found.', 500));
        } catch (err) {
            console.error('SSLCommerz initiation error:', { error: err.message, transactionId });
            return next(new CustomError('Payment initiation failed. Please try again later.', 500));
        }
    });

    static handleIpn = asyncHandler(async (req, res, next) => {
        const data = req.body;
        console.log('IPN Request Received:', { body: data, headers: req.headers }); // Enhanced logging

        // Validate mandatory fields
        if (!data.tran_id || !data.amount || !data.val_id) {
            console.warn('Invalid IPN data:', { tran_id: data.tran_id, amount: data.amount, val_id: data.val_id });
            return res.status(400).send('Invalid IPN data');
        }

        const sslcz = new SSLCommerzPayment(
            process.env.SSL_STORE_ID,
            process.env.SSL_STORE_PASSWORD,
            false // Sandbox mode
        );

        try {
            const validation = await sslcz.validate({ val_id: data.val_id });
            console.log('Validation Response:', validation); // Log validation response

            // Check transaction status
            if (validation.status !== 'VALID' && validation.status !== 'VALIDATED') {
                console.warn(`IPN: Transaction ${data.tran_id} is not valid. Status: ${validation.status}`);
                return res.status(200).send('IPN handled, but transaction not valid.');
            }

            // Verify transaction consistency
            if (validation.tran_id !== data.tran_id || parseFloat(validation.amount) !== parseFloat(data.amount)) {
                console.warn(`IPN: Transaction mismatch. Original: ${data.tran_id}/${data.amount}, Validated: ${validation.tran_id}/${validation.amount}`);
                return res.status(200).send('IPN handled, but transaction details mismatch.');
            }

            // Check for customer email
            if (!validation.cus_email) {
                console.warn(`IPN: Missing customer email for transaction ${data.tran_id}.`);
                return res.status(200).send('IPN handled, but customer email not found.');
            }

            // Validate email format
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(validation.cus_email)) {
                console.warn(`Invalid email format: ${validation.cus_email}`);
                return res.status(200).send('IPN handled, but invalid email format.');
            }

            const tranId = validation.tran_id;
            const amount = parseFloat(validation.amount);
            const email = validation.cus_email.toLowerCase(); // Normalize email

            // Find user
            const user = await User.findOne({ email });
            if (!user) {
                console.warn(`IPN: User with email ${email} not found for transaction ${tranId}.`);
                return res.status(200).send('IPN handled, but user not found.');
            }

            // Check for duplicate transaction
            if (Array.isArray(user.transactions) && user.transactions.includes(tranId)) {
                console.warn(`IPN: Duplicate transaction ${tranId} detected.`);
                return res.status(200).send('IPN handled, duplicate transaction.');
            }

            // Update user data
            try {
                user.donatedAmount = (user.donatedAmount || 0) + amount;
                user.transactions = Array.isArray(user.transactions) ? [...user.transactions, tranId] : [tranId];
                await user.save();
                console.log(`User updated: ${user.email}, Donated: ${user.donatedAmount}, Transaction: ${tranId}`);
            } catch (saveError) {
                console.error('User save error:', { error: saveError.message, email, tranId });
                return res.status(500).send('Error saving user data.'); // Allow retry
            }

            // Send confirmation email
            const emailSubject = 'Thank You for Your Donation!';
            const emailHtml = `
                <p>Dear ${user.firstName},</p>
                <p>Thank you for your generous donation of <strong>BDT ${amount.toFixed(2)}</strong> to FundRaiser!</p>
                <p>Your transaction ID is: <strong>${tranId}</strong></p>
                <p>Your support helps us continue our work. We truly appreciate it!</p>
                <p>Best regards,<br>The FundRaiser Team</p>
            `;
            const emailText = `Dear ${user.firstName},\n\nThank you for your generous donation of BDT ${amount.toFixed(2)} to FundRaiser!\n\nYour transaction ID is: ${tranId}\n\nYour support helps us continue our work. We truly appreciate it!\n\nBest regards,\nThe FundRaiser Team`;

            try {
                await sendEmail({
                    email: user.email,
                    subject: emailSubject,
                    message: emailText,
                    html: emailHtml,
                    replyTo: process.env.ADMIN_EMAIL
                });
                console.log('Donation email sent to:', user.email);
                return res.status(200).send('IPN handled successfully. User updated and email sent.');
            } catch (emailError) {
                console.error('Email sending failed:', { error: emailError.message, email: user.email, tranId });
                return res.status(200).send('IPN handled successfully. User updated, but email sending failed.');
            }
        } catch (error) {
            console.error('IPN processing error:', { error: error.message, tran_id: data.tran_id, val_id: data.val_id });
            return res.status(500).send('Error processing IPN.'); // Allow retry
        }
    });

    static paymentSuccess = asyncHandler(async (req, res, next) => {
        const { tran_id } = req.query;
        if (!tran_id) {
            return next(new CustomError('Invalid transaction ID', 400));
        }
        if (!process.env.FRONTEND_URL) {
            return next(new CustomError('Frontend URL not configured', 500));
        }
        return res.redirect(303, `${process.env.FRONTEND_URL}/payment-success.html?tran_id=${encodeURIComponent(tran_id)}`);
    });

    static paymentFail = asyncHandler(async (req, res, next) => {
        if (!process.env.FRONTEND_URL) {
            return next(new CustomError('Frontend URL not configured', 500));
        }
        return res.redirect(303, `${process.env.FRONTEND_URL}/payment-fail.html`);
    });

    static paymentCancel = asyncHandler(async (req, res, next) => {
        if (!process.env.FRONTEND_URL) {
            return next(new CustomError('Frontend URL not configured', 500));
        }
        return res.redirect(303, `${process.env.FRONTEND_URL}/payment-cancel.html`);
    });
}

module.exports = PaymentController;
