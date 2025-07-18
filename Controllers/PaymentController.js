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
    // Configuration constants
    static CONFIG = {
        CURRENCY: 'BDT',
        COUNTRY: 'Bangladesh',
        DEFAULT_POSTCODE: '1000',
        PRODUCT_CATEGORY: 'Donation',
        PRODUCT_PROFILE: 'non-physical-goods',
        SHIPPING_METHOD: 'NO',
        EMI_OPTION: 0
    };

    // Generate unique transaction ID
    static generateTransactionId() {
        return `TR${Date.now()}${uuidv4().slice(0, 8).toUpperCase()}`;
    }

    // Initiate payment
    static initiatePayment = asyncHandler(async (req, res, next) => {
        const user = req.user;
        const { amount } = req.body;

        // Input validation
        if (!user) {
            return next(new CustomError('User not authenticated.', 401));
        }
        if (!user.email) {
            return next(new CustomError('User email is missing in profile.', 400));
        }
        if (!amount || isNaN(amount) || amount <= 0) {
            return next(new CustomError('Please provide a valid donation amount.', 400));
        }

        const transactionId = PaymentController.generateTransactionId();
        const sslcz = new SSLCommerzPayment(
            process.env.SSL_STORE_ID,
            process.env.SSL_STORE_PASSWORD,
            process.env.NODE_ENV !== 'production' // Sandbox mode in non-production
        );

        const data = {
            total_amount: parseFloat(amount).toFixed(2),
            currency: PaymentController.CONFIG.CURRENCY,
            tran_id: transactionId,
            success_url: `${process.env.BACKEND_URL}/api/payment/success?tran_id=${encodeURIComponent(transactionId)}`,
            fail_url: `${process.env.BACKEND_URL}/api/payment/fail`,
            cancel_url: `${process.env.BACKEND_URL}/api/payment/cancel`,
            ipn_url: `${process.env.BACKEND_URL}/api/payment/ipn`,
            product_category: PaymentController.CONFIG.PRODUCT_CATEGORY,
            product_name: `Donation by ${user.firstName || ''} ${user.lastName || ''}`,
            num_item: 1,
            product_profile: PaymentController.CONFIG.PRODUCT_PROFILE,
            cus_name: `${user.firstName || ''} ${user.lastName || ''}`,
            cus_email: user.email,
            cus_add1: user.address?.line1 || 'N/A',
            cus_add2: user.address?.line2 || 'N/A',
            cus_city: user.address?.city || 'N/A',
            cus_state: user.address?.state || 'N/A',
            cus_postcode: user.address?.zip || PaymentController.CONFIG.DEFAULT_POSTCODE,
            cus_country: PaymentController.CONFIG.COUNTRY,
            cus_phone: user.phone || 'N/A',
            cus_fax: 'N/A',
            shipping_method: PaymentController.CONFIG.SHIPPING_METHOD,
            ship_name: `${user.firstName || ''} ${user.lastName || ''}`,
            ship_add1: user.address?.line1 || 'N/A',
            ship_add2: user.address?.line2 || 'N/A',
            ship_city: user.address?.city || 'N/A',
            ship_state: user.address?.state || 'N/A',
            ship_postcode: user.address?.zip || PaymentController.CONFIG.DEFAULT_POSTCODE,
            ship_country: PaymentController.CONFIG.COUNTRY,
            emi_option: PaymentController.CONFIG.EMI_OPTION
        };

        try {
            const apiResponse = await sslcz.init(data);
            if (!apiResponse.GatewayPageURL) {
                console.error('SSLCommerz initiation failed:', apiResponse);
                return next(new CustomError('Failed to initiate payment. No Gateway URL found.', 500));
            }

            // Store transaction in user's record immediately
            await User.findByIdAndUpdate(user._id, {
                $push: {
                    transactions: {
                        id: transactionId,
                        amount: data.total_amount,
                        status: 'initiated',
                        createdAt: new Date()
                    }
                }
            });

            return res.status(200).json({
                success: true,
                message: 'Redirecting to SSLCommerz gateway...',
                gatewayUrl: apiResponse.GatewayPageURL,
                transactionId
            });
        } catch (err) {
            console.error('SSLCommerz initiation error:', err);
            return next(new CustomError('Payment initiation failed. Please try again later.', 500));
        }
    });

    // Handle IPN
    static handleIpn = asyncHandler(async (req, res, next) => {
        const data = req.body;
        console.log('IPN Received:', JSON.stringify(data, null, 2));

        // Validate required fields
        if (!data.tran_id || !data.amount || !data.val_id) {
            console.warn('Invalid IPN data - missing required fields');
            return res.status(400).send('Invalid IPN data');
        }

        const sslcz = new SSLCommerzPayment(
            process.env.SSL_STORE_ID,
            process.env.SSL_STORE_PASSWORD,
            process.env.NODE_ENV !== 'production'
        );

        try {
            const validation = await sslcz.validate({ val_id: data.val_id });
            console.log('Validation Response:', validation);

            if (validation.status !== 'VALID' && validation.status !== 'VALIDATED') {
                console.warn(`Transaction validation failed for ${data.tran_id}`);
                return res.status(200).send('IPN handled, but transaction not valid.');
            }

            // Find user by transaction ID
            const user = await User.findOneAndUpdate(
                { 'transactions.id': data.tran_id },
                {
                    $inc: { donatedAmount: parseFloat(validation.amount) },
                    $set: {
                        'transactions.$.status': 'completed',
                        'transactions.$.details': validation,
                        'transactions.$.completedAt': new Date(),
                        'transactions.$.paymentMethod': validation.card_issuer || 'Unknown'
                    }
                },
                { new: true }
            );

            if (!user) {
                console.warn(`User not found for transaction ${data.tran_id}`);
                return res.status(200).send('IPN handled, but user not found.');
            }

            // Send confirmation email
            try {
                const emailSubject = 'Thank You for Your Donation!';
                const emailHtml = `
                    <p>Dear ${user.firstName},</p>
                    <p>Thank you for your generous donation of <strong>BDT ${parseFloat(validation.amount).toFixed(2)}</strong>!</p>
                    <p>Transaction ID: <strong>${data.tran_id}</strong></p>
                    <p>Date: <strong>${new Date(validation.tran_date).toLocaleString()}</strong></p>
                    <p>Payment Method: <strong>${validation.card_issuer || 'N/A'}</strong></p>
                    <p>Your support makes a difference!</p>
                `;

                await sendEmail({
                    email: user.email,
                    subject: emailSubject,
                    html: emailHtml,
                    replyTo: process.env.ADMIN_EMAIL
                });

                console.log(`Confirmation email sent to ${user.email}`);
                return res.status(200).send('IPN handled successfully. User updated and email sent.');
            } catch (emailError) {
                console.error('Failed to send confirmation email:', emailError);
                return res.status(200).send('IPN handled successfully. User updated but email failed.');
            }
        } catch (error) {
            console.error('IPN processing error:', error);
            return res.status(500).send('Error processing IPN.');
        }
    });

    // Handle payment success (GET callback)
    static paymentSuccess = asyncHandler(async (req, res, next) => {
        const { tran_id } = req.query;

        if (!tran_id) {
            console.warn('Success callback called without transaction ID');
            return res.redirect(`${process.env.FRONTEND_URL}/payment-error?message=Missing transaction ID`);
        }

        try {
            // Verify the transaction exists in our system
            const user = await User.findOne({ 'transactions.id': tran_id });
            if (!user) {
                console.warn(`Success callback for unknown transaction: ${tran_id}`);
                return res.redirect(`${process.env.FRONTEND_URL}/payment-error?message=Transaction not found`);
            }

            // Redirect to frontend with success status
            return res.redirect(303, `${process.env.FRONTEND_URL}/payment-success?tran_id=${encodeURIComponent(tran_id)}`);
        } catch (error) {
            console.error('Error in payment success handler:', error);
            return res.redirect(`${process.env.FRONTEND_URL}/payment-error?message=Error processing payment`);
        }
    });

    // Handle payment failure (GET callback)
    static paymentFail = asyncHandler(async (req, res, next) => {
        const { tran_id } = req.query;

        if (tran_id) {
            try {
                // Update transaction status to failed if we have the ID
                await User.updateOne(
                    { 'transactions.id': tran_id },
                    {
                        $set: {
                            'transactions.$.status': 'failed',
                            'transactions.$.failedAt': new Date()
                        }
                    }
                );
            } catch (error) {
                console.error('Error updating failed transaction:', error);
            }
        }

        return res.redirect(303, `${process.env.FRONTEND_URL}/payment-failed${tran_id ? `?tran_id=${encodeURIComponent(tran_id)}` : ''}`);
    });

    // Handle payment cancellation (GET callback)
    static paymentCancel = asyncHandler(async (req, res, next) => {
        const { tran_id } = req.query;

        if (tran_id) {
            try {
                // Update transaction status to cancelled if we have the ID
                await User.updateOne(
                    { 'transactions.id': tran_id },
                    {
                        $set: {
                            'transactions.$.status': 'cancelled',
                            'transactions.$.cancelledAt': new Date()
                        }
                    }
                );
            } catch (error) {
                console.error('Error updating cancelled transaction:', error);
            }
        }

        return res.redirect(303, `${process.env.FRONTEND_URL}/payment-cancelled${tran_id ? `?tran_id=${encodeURIComponent(tran_id)}` : ''}`);
    });

    // Handle server-to-server success callback (POST)
    static handleSuccessCallback = asyncHandler(async (req, res) => {
        const { tran_id, val_id, amount, currency, card_type } = req.body;

        // Validate required fields
        if (!tran_id || !val_id) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['tran_id', 'val_id']
            });
        }

        try {
            const sslcz = new SSLCommerzPayment(
                process.env.SSL_STORE_ID,
                process.env.SSL_STORE_PASSWORD,
                process.env.NODE_ENV !== 'production'
            );

            const validation = await sslcz.validate({ val_id });

            if (validation.status !== 'VALID' && validation.status !== 'VALIDATED') {
                return res.status(400).json({ error: 'Payment validation failed' });
            }

            // Update user transaction record
            const updatedUser = await User.findOneAndUpdate(
                { 'transactions.id': tran_id },
                {
                    $set: {
                        'transactions.$.status': 'completed',
                        'transactions.$.verified': true,
                        'transactions.$.amount': amount,
                        'transactions.$.currency': currency,
                        'transactions.$.paymentMethod': card_type,
                        'transactions.$.completedAt': new Date(),
                        'transactions.$.validation': validation
                    },
                    $inc: { totalDonations: parseFloat(amount) }
                },
                { new: true, runValidators: true }
            );

            if (!updatedUser) {
                return res.status(404).json({ error: 'Transaction not found' });
            }

            res.status(200).json({
                success: true,
                message: 'Payment successfully processed',
                transactionId: tran_id
            });
        } catch (error) {
            console.error('Error in handleSuccessCallback:', error);
            res.status(500).json({
                error: 'Internal server error',
                details: error.message
            });
        }
    });

    // Handle server-to-server fail callback (POST)
    static handleFailCallback = asyncHandler(async (req, res) => {
        const { tran_id, error, bank_tran_id } = req.body;

        if (!tran_id) {
            return res.status(400).json({ error: 'Transaction ID required' });
        }

        try {
            // Update transaction status
            const updatedUser = await User.findOneAndUpdate(
                { 'transactions.id': tran_id },
                {
                    $set: {
                        'transactions.$.status': 'failed',
                        'transactions.$.error': error || 'Payment failed',
                        'transactions.$.bankTransactionId': bank_tran_id || null,
                        'transactions.$.failedAt': new Date()
                    }
                },
                { new: true }
            );

            if (!updatedUser) {
                return res.status(404).json({ error: 'Transaction not found' });
            }

            res.status(200).json({
                success: true,
                message: 'Payment failure recorded',
                transactionId: tran_id
            });
        } catch (error) {
            console.error('Error in handleFailCallback:', error);
            res.status(500).json({
                error: 'Internal server error',
                details: error.message
            });
        }
    });

    // Handle server-to-server cancel callback (POST)
    static handleCancelCallback = asyncHandler(async (req, res) => {
        const { tran_id, reason } = req.body;

        if (!tran_id) {
            return res.status(400).json({ error: 'Transaction ID required' });
        }

        try {
            // Update transaction status
            const updatedUser = await User.findOneAndUpdate(
                { 'transactions.id': tran_id },
                {
                    $set: {
                        'transactions.$.status': 'cancelled',
                        'transactions.$.cancellationReason': reason || 'User cancelled',
                        'transactions.$.cancelledAt': new Date()
                    }
                },
                { new: true }
            );

            if (!updatedUser) {
                return res.status(404).json({ error: 'Transaction not found' });
            }

            res.status(200).json({
                success: true,
                message: 'Payment cancellation recorded',
                transactionId: tran_id
            });
        } catch (error) {
            console.error('Error in handleCancelCallback:', error);
            res.status(500).json({
                error: 'Internal server error',
                details: error.message
            });
        }
    });
}

module.exports = PaymentController;