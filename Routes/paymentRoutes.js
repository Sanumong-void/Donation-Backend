const router = require('express').Router();

const PaymentController = require('../Controllers/PaymentController');
const authenticateUser = require('../Auth/authentication');

// Route to initiate payment

router.post('/initiate', authenticateUser, PaymentController.initiatePayment);
router.post('/ipn', PaymentController.handleIpn); // IPN does not need authentication as it's from SSLCommerz server

// Route to handle payment success
router.get('/success', PaymentController.paymentSuccess);
// Route to handle payment failure
router.get('/fail', PaymentController.paymentFail);
// Route to handle payment cancellation
router.get('/cancel', PaymentController.paymentCancel);
module.exports = router;