const SSLCommerzPayment = require('sslcommerz-lts');
const CustomError = require('../Utils/CustomError');
const asyncHandler = require('../Utils/asyncHandler');
const sendEmail = require('../Utils/emailSender');
const User = require('../Models/userSchema');
const { v4: uuidv4 } = require('uuid');

// Environment Validation
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

        if (!user) return next(new CustomError('User not authenticated.', 401));
        if (!user.email) return next(new CustomError('User email is missing in profile.', 400));
        if (!amount || typeof amount !== 'number' || amount <= 0)
            return next(new CustomError('Please provide a valid donation amount.', 400));

        const transactionId = this.generateTransactionId();
        const sslcz = new SSLCommerzPayment(
            process.env.SSL_STORE_ID,
            process.env.SSL_STORE_PASSWORD,
            false
        );

        const data = {
            total_amount: parseFloat(amount.toFixed(2)),
            currency: this.CONFIG.CURRENCY,
            tran_id: transactionId,
            success_url: `${process.env.FRONTEND_URL}/HTML/payment-success.html?tran_id=${encodeURIComponent(transactionId)}`,
            fail_url: `${process.env.FRONTEND_URL}/HTML/payment-fail.html`,
            cancel_url: `${process.env.FRONTEND_URL}/HTML/payment-cancel.html`,
            ipn_url: `${process.env.BACKEND_URL}/api/payment/ipn`,
            product_category: this.CONFIG.PRODUCT_CATEGORY,
            product_name: `Donation by ${user.firstName} ${user.lastName}`,
            num_item: 1,
            product_profile: this.CONFIG.PRODUCT_PROFILE,
            cus_name: `${user.firstName} ${user.lastName}`,
            cus_email: user.email,
            cus_add1: user.address?.line1 || 'N/A',
            cus_add2: user.address?.line2 || 'N/A',
            cus_city: user.address?.city || 'N/A',
            cus_state: user.address?.state || 'N/A',
            cus_postcode: user.address?.zip || this.CONFIG.DEFAULT_POSTCODE,
            cus_country: this.CONFIG.COUNTRY,
            cus_phone: user.phone || 'N/A',
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
            if (apiResponse?.GatewayPageURL) {
                return res.status(200).json({
                    success: true,
                    message: 'Redirecting to SSLCommerz gateway...',
                    gatewayUrl: apiResponse.GatewayPageURL,
                    transactionId
                });
            }
            return next(new CustomError('Failed to initiate payment. No Gateway URL found.', 500));
        } catch (err) {
            console.error('SSLCommerz initiation error:', err.message || err);
            return next(new CustomError('Payment initiation failed. Please try again later.', 500));
        }
    });

    static handleIpn = asyncHandler(async (req, res, next) => {
        const data = req.body;
        console.log('Full IPN Payload:', JSON.stringify(data, null, 2));

        if (!data.tran_id || !data.amount || !data.val_id) {
            console.warn('Invalid IPN data:', { tran_id: data.tran_id, amount: data.amount, val_id: data.val_id });
            return res.status(400).send('Invalid IPN data');
        }

        if (data.cus_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.cus_email)) {
            console.warn(`Invalid email format: ${data.cus_email}`);
            return res.status(200).send('IPN handled, but invalid email format.');
        }

        const sslcz = new SSLCommerzPayment(
            process.env.SSL_STORE_ID,
            process.env.SSL_STORE_PASSWORD,
            false
        );

        try {
            const validation = await sslcz.validate({ val_id: data.val_id });
            console.log('Validation Response:', JSON.stringify(validation, null, 2));

            if (!['VALID', 'VALIDATED'].includes(validation.status)) {
                console.warn(`Transaction ${data.tran_id} not valid: ${validation.status}`);
                return res.status(200).send('IPN handled, but transaction not valid.');
            }

            const tranId = validation.tran_id;
            const amount = parseFloat(validation.amount);
            const email = data.cus_email || 'N/A';

            const userQuery = data.cus_email ? { email: data.cus_email } : { transactions: tranId };
            const user = await User.findOne(userQuery);

            if (!user) {
                console.warn(`User not found: ${email}`);
                return res.status(200).send('IPN handled, but user not found.');
            }

            if (user.transactions?.includes(tranId)) {
                console.warn(`Duplicate transaction: ${tranId}`);
                return res.status(200).send('IPN handled, duplicate transaction.');
            }

            user.donatedAmount = (user.donatedAmount || 0) + amount;
            user.transactions = [...(user.transactions || []), tranId];
            await user.save();

            try {
                await sendEmail({
                    email: user.email,
                    subject: 'Thank You for Your Donation!',
                    message: `Dear ${user.firstName},\n\nThank you for your generous donation of BDT ${amount.toFixed(2)} to FundRaiser!\n\nYour transaction ID is: ${tranId}\n\nYour support helps us continue our work.\n\nRegards,\nFundRaiser Team`,
                    html: `
                        <p>Dear ${user.firstName},</p>
                        <p>Thank you for your donation of <strong>BDT ${amount.toFixed(2)}</strong> to FundRaiser!</p>
                        <p>Your transaction ID is <strong>${tranId}</strong></p>
                        <p>We appreciate your support!</p>
                        <p>Best regards,<br>FundRaiser Team</p>
                    `,
                    replyTo: process.env.ADMIN_EMAIL
                });
                console.log('Donation email sent to:', user.email);
            } catch (emailError) {
                console.error('Email sending error:', emailError.message);
            }

            return res.status(200).send('IPN handled successfully.');
        } catch (error) {
            console.error('IPN validation failed:', error.message);
            return res.status(500).send('Error processing IPN.');
        }
    });

    static paymentSuccess = asyncHandler(async (req, res, next) => {
        const { tran_id } = req.query;
        if (!tran_id) return next(new CustomError('Invalid transaction ID', 400));
        if (!process.env.FRONTEND_URL) return next(new CustomError('Frontend URL not configured', 500));
        return res.redirect(303, `${process.env.FRONTEND_URL}/HTML/payment-success.html?tran_id=${encodeURIComponent(tran_id)}`);
    });

    static paymentFail = asyncHandler(async (_req, res, next) => {
        if (!process.env.FRONTEND_URL) return next(new CustomError('Frontend URL not configured', 500));
        return res.redirect(303, `${process.env.FRONTEND_URL}/HTML/payment-fail.html`);
    });

    static paymentCancel = asyncHandler(async (_req, res, next) => {
        if (!process.env.FRONTEND_URL) return next(new CustomError('Frontend URL not configured', 500));
        return res.redirect(303, `${process.env.FRONTEND_URL}/HTML/payment-cancel.html`);
    });
}

module.exports = PaymentController;