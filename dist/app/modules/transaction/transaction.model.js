"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transactionModel = void 0;
const mongoose_1 = require("mongoose");
const transaction_constant_1 = require("./transaction.constant");
const transactionSchema = new mongoose_1.Schema({
    user: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
        required: [true, "User is required !!!"],
    },
    type: {
        type: String,
        enum: Object.values(transaction_constant_1.transactionConstants),
        required: [true, "Transaction type is required !!!"],
    },
    title: {
        type: String,
        required: [true, "Transaction title is required !!!"],
        trim: true,
    },
    description: {
        type: String,
    },
    amount: {
        type: Number,
        required: [true, "Transaction amount is required !!!"],
        min: 0,
    },
    isDeleted: {
        type: Boolean,
        default: false,
    },
}, { timestamps: true });
//
exports.transactionModel = (0, mongoose_1.model)("Transaction", transactionSchema);
