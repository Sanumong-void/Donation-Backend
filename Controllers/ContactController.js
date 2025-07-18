const asyncHandler = require('../Utils/asyncHandler');
const CustomError = require('../Utils/CustomError');
const sendEmail = require('../Utils/emailSender'); // Your email utility

class ContactController {
    static submitContactForm = asyncHandler(async (req, res, next) => {
        const { name, email, subject, message } = req.body;

        // 1. Basic Validation
        if (!name || !email || !subject || !message) {
            return next(new CustomError("All fields (Name, Email, Subject, Message) are required.", 400));
        }

        // 2. Define Email Content
        const adminEmail = process.env.ADMIN_EMAIL; // This should be defined in your .env
        if (!adminEmail) {
            console.error("ADMIN_EMAIL is not defined in .env");
            return next(new CustomError("Server is not configured to receive contact messages. Please try again later.", 500));
        }

        const emailSubject = `New Contact Form Submission: ${subject}`;
        const emailHtml = `
            <h3>New Message from FundRaiser Contact Form</h3>
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Subject:</strong> ${subject}</p>
            <p><strong>Message:</strong></p>
            <p style="border: 1px solid #eee; padding: 10px; background-color: #f9f9f9;">${message}</p>
            <br>
            <p><em>This email was sent from your FundRaiser website contact form.</em></p>
        `;
        const emailText = `New Message from FundRaiser Contact Form\n\nName: ${name}\nEmail: ${email}\nSubject: ${subject}\nMessage: ${message}\n\nThis email was sent from your FundRaiser website contact form.`;


        // 3. Send the Email
        try {
            await sendEmail({
                email: adminEmail, // Recipient: your admin email
                subject: emailSubject,
                message: emailText, // Plain text version
                html: emailHtml, // HTML version
                replyTo: email // Set the user's email as reply-to
            });

            res.status(200).json({
                success: true,
                message: "Your message has been sent successfully! We will get back to you soon."
            });

        } catch (error) {
            console.error("Error sending contact form email:", error);
            return next(new CustomError("Failed to send your message. Please try again later.", 500));
        }
    });
}

module.exports = ContactController;