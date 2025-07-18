// Routes/paymentRoutes.js (or whatever you've named it)
const router = require('express').Router();
const PaymentController = require('../Controllers/PaymentController');
const authenticateUser = require('../Auth/authentication'); // Assuming this path is correct

// Route to initiate payment (requires authentication)
router.post('/initiate', authenticateUser, PaymentController.initiatePayment);

// Route for IPN (Instant Payment Notification) from SSLCommerz.
// This route does NOT require authentication as it's a server-to-server call.
router.post('/ipn', PaymentController.handleIpn);

// Route to handle payment success.
// SSLCommerz redirects the user's browser via a GET request to this URL.
router.get('/success', PaymentController.paymentSuccess);

// Route to handle payment failure.
// SSLCommerz redirects the user's browser via a POST request to this URL.
router.post('/fail', PaymentController.paymentFail);

// Route to handle payment cancellation.
// SSLCommerz redirects the user's browser via a POST request to this URL.
router.post('/cancel', PaymentController.paymentCancel);

module.exports = router;