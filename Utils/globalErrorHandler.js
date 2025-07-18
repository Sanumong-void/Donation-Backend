const CustomError = require("../Utils/CustomError");

const globalErrorHandler = (err, req, res, next) => {
    console.log(err);
    if (err instanceof CustomError) {
        return res.status(err.statusCode).json({ message: err.message });
    }
    return res.status(500).json({ message: "Internal Server Error" });
}

module.exports = globalErrorHandler;