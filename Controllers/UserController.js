const User = require('../Models/userSchema');
const CustomError = require('../Utils/CustomError');
const asyncHandler = require('../Utils/asyncHandler');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sendEmail = require('../Utils/emailSender'); // Your email utility

class UserController {
    // create User
    static createUser = asyncHandler(async (req, res, next) => {
        const { firstName, lastName, email, phone, password, confirmPassword, userName, Description } = req.body;
        if (!firstName || !lastName || !email || !phone || !password || !userName || !Description || !confirmPassword) {
            return next(new CustomError("All fields are required", 400));
        }
        if (password !== confirmPassword) {
            return next(new CustomError("Passwords do not match", 400));
        }
        const isUserExist = await User.findOne({ email: email });
        if (isUserExist) {
            return next(new CustomError("User already exists", 400));
        }
        const user = new User({ firstName, lastName, email, phone, password, userName, Description });
        await user.save();

        // --- NEW: Send Welcome Email After User is Created ---
        const welcomeSubject = 'Welcome to FundRaiser!';
        const welcomeMessageText = `Dear ${firstName},\n\nWelcome to FundRaiser! We're excited to have you join our community.\n\nStart exploring trending campaigns and make a difference today.\n\nBest regards,\nThe FundRaiser Team`;
        const welcomeMessageHtml = `
            <p>Dear <strong>${firstName}</strong>,</p>
            <p>Welcome to FundRaiser! We're excited to have you join our community.</p>
            <p>Here at FundRaiser, you can:</p>
            <ul>
                <li>Explore various trending campaigns.</li>
                <li>Support causes you care about.</li>
                <li>Start your own fundraising initiatives (if enabled).</li>
            </ul>
            <p>Start exploring <a href="${process.env.FRONTEND_URL}/index.html#trending" style="color:#007bff; text-decoration:none;">trending campaigns</a> and make a difference today.</p>
            <p>If you have any questions, feel free to reply to this email.</p>
            <p>Best regards,<br>The FundRaiser Team</p>
        `;

        try {
            await sendEmail({
                email: user.email, // Send to the newly registered user's email
                subject: welcomeSubject,
                message: welcomeMessageText,
                html: welcomeMessageHtml,
                replyTo: process.env.ADMIN_EMAIL // Allow replies to go to your admin email
            });
            console.log(`Welcome email sent to ${user.email}`);
        } catch (emailError) {
            console.error(`Failed to send welcome email to ${user.email}:`, emailError);
            // Don't block user registration if email fails, but log the error
        }
        // --- END NEW WELCOME EMAIL ---

        res.status(201).json({ message: "User created successfully", user });
    });

    // loginUser
    static login = asyncHandler(async (req, res, next) => {
        const { email, password } = req.body;
        if (!email || !password) {
            return next(new CustomError("Email and password are required", 400));
        }

        const user = await User.findOne({ email: email }).select('+password');
        if (!user) {
            return next(new CustomError("Invalid credentials", 401));
        }
        const isPasswordMatch = await bcrypt.compare(String(password), user.password);
        if (!isPasswordMatch) {
            return next(new CustomError("Invalid credentials", 401));
        }

        const token = jwt.sign(
            { userId: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '15d' }
        );
        res.cookie("token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production' ? true : false,
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
            maxAge: 15 * 24 * 60 * 60 * 1000,
            path: '/'
        });
        user.password = undefined;
        res.status(200).json({ message: "Login successful", user, token });
    });

    // logoutUser
    static logout = asyncHandler(async (req, res, next) => {
        res.cookie("token", null, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production' ? true : false,
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
            maxAge: 0,
            path: '/'
        });
        console.log("User logged out successfully");
        res.status(200).json({ message: "Logout successful" });
    });

    // getMe
    static getMe = asyncHandler(async (req, res, next) => {
        res.status(201).json({ message: "User found successfully", user: req.user });
    });
    static requestPasswordUpdateOtp = asyncHandler(async (req, res, next) => {
        const { email } = req.body;

        if (!email) {
            return next(new CustomError("Email is required.", 400));
        }

        const user = await User.findOne({ email });

        if (!user) {
            // Do not reveal if email exists for security reasons
            return next(new CustomError("If an account with that email exists, an OTP will be sent.", 200));
        }

        // Generate a 4-digit OTP
        const otp = Math.floor(1000 + Math.random() * 9000).toString(); // Generates 4-digit number
        const otpExpires = Date.now() + 10 * 60 * 1000; // OTP valid for 10 minutes from now

        // Hash the OTP before saving to database
        const salt = await bcrypt.genSalt(10);
        user.otp = await bcrypt.hash(otp, salt);
        user.otpExpires = otpExpires;
        await user.save();

        const emailSubject = 'FundRaiser Password Update OTP';
        const emailHtml = `
            <p>Dear ${user.firstName},</p>
            <p>You have requested to update your password for your FundRaiser account.</p>
            <p>Your One-Time Password (OTP) is: <strong>${otp}</strong></p>
            <p>This OTP is valid for 10 minutes. Please do not share this with anyone.</p>
            <p>If you did not request this, please ignore this email or contact support.</p>
            <p>Best regards,<br>The FundRaiser Team</p>
        `;
        const emailText = `Dear ${user.firstName},\n\nYou have requested to update your password for your FundRaiser account.\n\nYour One-Time Password (OTP) is: ${otp}\n\nThis OTP is valid for 10 minutes. Please do not share this with anyone.\n\nIf you did not request this, please ignore this email or contact support.\n\nBest regards,\nThe FundRaiser Team`;

        try {
            await sendEmail({
                email: user.email,
                subject: emailSubject,
                message: emailText,
                html: emailHtml,
                replyTo: process.env.ADMIN_EMAIL
            });
            res.status(200).json({
                success: true,
                message: "OTP sent to your email. Please check your inbox."
            });
        } catch (emailError) {
            // If email fails, clear the OTP from user record to prevent stale OTP issues
            user.otp = null;
            user.otpExpires = null;
            await user.save();
            console.error("Error sending OTP email:", emailError);
            return next(new CustomError("Failed to send OTP. Please try again later.", 500));
        }
    });

    // NEW: Update password with OTP
    static updatePasswordWithOtp = asyncHandler(async (req, res, next) => {
        const { email, otp, newPassword } = req.body;

        if (!email || !otp || !newPassword) {
            return next(new CustomError("Email, OTP, and new password are required.", 400));
        }

        if (newPassword.length < 8) {
            return next(new CustomError("New password must be at least 8 characters long.", 400));
        }

        const user = await User.findOne({ email });

        if (!user) {
            return next(new CustomError("User not found.", 404));
        }

        // 1. Check if OTP exists and is not expired
        if (!user.otp || !user.otpExpires || user.otpExpires < Date.now()) {
            // Clear expired OTP to prevent future misuse
            user.otp = null;
            user.otpExpires = null;
            await user.save();
            return next(new CustomError("Invalid or expired OTP. Please request a new one.", 400));
        }

        // 2. Verify OTP
        const isOtpValid = await bcrypt.compare(otp, user.otp);

        if (!isOtpValid) {
            return next(new CustomError("Invalid OTP.", 400));
        }

        // 3. Update Password
        user.password = newPassword; // Mongoose pre-save hook will hash this
        user.otp = null; // Clear OTP after successful use
        user.otpExpires = null; // Clear OTP expiry
        await user.save();

        res.status(200).json({
            success: true,
            message: "Password updated successfully!"
        });
    });
}

module.exports = UserController;