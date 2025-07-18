const jwt = require('jsonwebtoken');
const asyncHandler = require('../Utils/asyncHandler');
const CustomError = require('../Utils/CustomError');
const User = require('../Models/userSchema');

// Middleware to authenticate user

const authenticateUser = async (req, res, next) => {
    try {
        const token = req.cookies.token || req.headers.Authorization?.split(' ')[1];
        if (!token) {
            return next(new CustomError("Authentication token is missing", 401));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = await User.findById(decoded.userId);
        if (!req.user) {
            return next(new CustomError("User not found", 404));
        }
        next();
    } catch (error) {
        return next(new CustomError("Invalid authentication token", 401));
    }
};

module.exports = authenticateUser;