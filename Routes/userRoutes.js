const express = require('express');
const router = express.Router();
const UserController = require('../Controllers/UserController');
const authenticateUser = require('../Auth/authentication');
const PaymentController = require('../Controllers/PaymentController');

// Route to create a new user
router.post('/register', UserController.createUser);
router.post('/login', UserController.login);
router.post('/logout', authenticateUser, UserController.logout);
router.get("/getMe", authenticateUser, UserController.getMe);
router.post("/requestPasswordUpdateOtp", authenticateUser, UserController.requestPasswordUpdateOtp);
router.patch("/updatePassword", authenticateUser, UserController.updatePasswordWithOtp);

module.exports = router;