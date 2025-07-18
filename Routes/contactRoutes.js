// Routes/contactRoutes.js
const express = require('express');
const router = express.Router();
const ContactController = require("../Controllers/ContactController");

// Define the POST route for contact form submissions
router.post('/sendMessage', ContactController.submitContactForm);

module.exports = router;