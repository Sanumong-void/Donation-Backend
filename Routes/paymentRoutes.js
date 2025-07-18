const router = require('express').Router();
const PaymentController = require('../Controllers/PaymentController');
const authenticateUser = require('../Auth/authentication');

// Payment initiation route (authenticated)
router.post(
    '/initiate',
    authenticateUser,
    PaymentController.initiatePayment
);

// SSLCommerz IPN (Instant Payment Notification) endpoint
router.post(
    '/ipn',
    PaymentController.handleIpn
);

// Client-facing redirect endpoints (GET)
router.get(
    '/success',
    PaymentController.paymentSuccess
);
router.get(
    '/fail',
    PaymentController.paymentFail
);
router.get(
    '/cancel',
    PaymentController.paymentCancel
);

// Server-to-server callbacks (POST)
router.post(
    '/success-callback',
    PaymentController.handleSuccessCallback
);
router.post(
    '/fail-callback',
    PaymentController.handleFailCallback
);
router.post(
    '/cancel-callback',
    PaymentController.handleCancelCallback
);

module.exports = router;