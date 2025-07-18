const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const transactionSchema = new mongoose.Schema({
    id: {
        type: String,
        required: true,
        unique: true  // This creates the index automatically
    },
    amount: {
        type: Number,
        required: true
    },
    currency: {
        type: String,
        default: 'BDT'
    },
    status: {
        type: String,
        enum: ['initiated', 'completed', 'failed', 'cancelled'],
        default: 'initiated'
    },
    paymentMethod: {
        type: String
    },
    bankTransactionId: {
        type: String
    },
    failReason: {
        type: String
    },
    validation: {
        type: Object
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    completedAt: {
        type: Date
    },
    failedAt: {
        type: Date
    },
    cancelledAt: {
        type: Date
    }
}, { _id: false });

const userSchema = new mongoose.Schema({
    firstName: {
        type: String,
        required: [true, 'First name is required'],
        trim: true,
        maxlength: [50, 'First name cannot exceed 50 characters']
    },
    lastName: {
        type: String,
        required: [true, 'Last name is required'],
        trim: true,
        maxlength: [50, 'Last name cannot exceed 50 characters']
    },
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,  // Creates index automatically
        trim: true,
        lowercase: true,
        validate: {
            validator: function (v) {
                return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
            },
            message: props => `${props.value} is not a valid email address!`
        }
    },
    phone: {
        type: String,
        required: [true, 'Phone number is required'],
        validate: {
            validator: function (v) {
                return /^[0-9]{11,15}$/.test(v);
            },
            message: props => `${props.value} is not a valid phone number!`
        }
    },
    userName: {
        type: String,
        required: [true, 'Username is required'],
        trim: true,
        unique: true,  // Creates index automatically
        minlength: [3, 'Username must be at least 3 characters'],
        maxlength: [30, 'Username cannot exceed 30 characters']
    },
    description: {
        type: String,
        required: [true, 'Description is required'],
        trim: true,
        maxlength: [500, 'Description cannot exceed 500 characters']
    },
    password: {
        type: String,
        required: [true, 'Password is required'],
        minlength: [6, 'Password must be at least 6 characters'],
        select: false
    },
    role: {
        type: String,
        enum: {
            values: ['user', 'admin'],
            message: 'Role must be either user or admin'
        },
        default: 'user'
    },
    otp: {
        type: String,
        select: false
    },
    otpExpires: {
        type: Date,
        select: false
    },
    donatedAmount: {
        type: Number,
        default: 0,
        min: [0, 'Donated amount cannot be negative']
    },
    transactions: [transactionSchema],
    address: {
        line1: String,
        line2: String,
        city: String,
        state: String,
        zip: String,
        country: String
    },
    isVerified: {
        type: Boolean,
        default: false
    },
    lastLogin: Date,
    accountStatus: {
        type: String,
        enum: ['active', 'suspended', 'deactivated'],
        default: 'active'
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// REMOVED ALL schema.index() CALLS - using only 'unique: true' in field definitions

// Hash password before saving
userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();

    try {
        this.password = await bcrypt.hash(this.password, 12);
        next();
    } catch (err) {
        next(err);
    }
});

// Method to compare passwords
userSchema.methods.comparePassword = async function (candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

// Virtual for full name
userSchema.virtual('fullName').get(function () {
    return `${this.firstName} ${this.lastName}`;
});

// Query helper for active users
userSchema.query.active = function () {
    return this.where({ accountStatus: 'active' });
};

const User = mongoose.model('User', userSchema);

module.exports = User;