require("dotenv").config();
const express = require("express");
const app = express();
const GlobalErrorHandler = require("./Utils/globalErrorHandler");
const databaseConnection = require("./Config/database");
const userRoutes = require("./Routes/userRoutes");
const CustomError = require("./Utils/CustomError");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const contactRoutes = require("./Routes/contactRoutes");
const paymentRoutes = require("./Routes/paymentRoutes");

// middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser())
app.use(cors({
    origin: process.env.FRONTEND_URL, // Use the variable from .env
    methods: "GET,POST,PUT,PATCH,DELETE",
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// db connection
databaseConnection();

// routes
app.use("/api/user", userRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/payment", paymentRoutes);

// error handler
app.use(GlobalErrorHandler);

// PORT Listening
app.listen(process.env.PORT, () => {
    console.log(`server is running at ${process.env.PORT}`)
})