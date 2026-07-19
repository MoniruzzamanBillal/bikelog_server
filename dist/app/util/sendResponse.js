"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sendResponse = (res, data) => {
    res.status(data.status).json({
        success: data.success,
        message: data.message,
        data: data.data,
        token: data.token,
    });
};
exports.default = sendResponse;
