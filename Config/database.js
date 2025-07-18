const mongoose = require('mongoose');
const asyncHandler = require('../Utils/asyncHandler');

const databaseConnection = asyncHandler(async () => {
    mongoose.connect(process.env.DB);
    const connection = mongoose.connection;
    connection.on('connected', () => {
        console.log('Database connected successfully');
    });
});

module.exports = databaseConnection;