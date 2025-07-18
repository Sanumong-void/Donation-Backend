// Routes/paymentRoutes.js
const router = require('express').Router();
const PaymentController = require('../Controllers/PaymentController');
const authenticateUser = require('../Auth/authentication');

// Route to initiate payment (requires authentication)
router.post('/initiate', authenticateUser, PaymentController.initiatePayment);

// IPN does not need authentication as it's from SSLCommerz server
router.post('/ipn', PaymentController.handleIpn);

// Route to handle payment success.
// SSLCommerz redirects the user's browser via a POST request to this URL.
router.post('/success', PaymentController.paymentSuccess); // <--- CHANGE THIS BACK TO POST

// Route to handle payment failure.
// SSLCommerz redirects the user's browser via a POST request to this URL.
router.post('/fail', PaymentController.paymentFail);

// Route to handle payment cancellation.
// SSLCommerz redirects the user's browser via a POST request to this URL.
router.post('/cancel', PaymentController.paymentCancel);

module.exports = router;