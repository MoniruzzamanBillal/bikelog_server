"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorLogModel = void 0;
const mongoose_1 = require("mongoose");
const errorLogSchema = new mongoose_1.Schema({
    status: {
        type: Number,
        required: true,
    },
    message: {
        type: String,
        required: true,
    },
    errorName: {
        type: String,
    },
    errorSources: [
        {
            path: { type: mongoose_1.Schema.Types.Mixed },
            message: { type: String },
            _id: false,
        },
    ],
    stack: {
        type: String,
    },
    method: {
        type: String,
        required: true,
    },
    path: {
        type: String,
        required: true,
    },
    userId: {
        type: String,
        default: null,
    },
    userEmail: {
        type: String,
        default: null,
    },
}, {
    timestamps: true,
});
// ! rolling 30-day retention — MongoDB's own TTL monitor deletes a document once
// ! (createdAt + 30 days) is in the past; runs as a background sweep, nothing the app triggers itself
errorLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
// ! supports the default admin list sort (-createdAt) and status-filtered lookups efficiently
errorLogSchema.index({ status: 1, createdAt: -1 });
exports.errorLogModel = (0, mongoose_1.model)("ErrorLog", errorLogSchema);
