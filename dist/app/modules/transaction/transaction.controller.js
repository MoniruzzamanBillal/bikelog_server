"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.transactionControllers = void 0;
const http_status_1 = __importDefault(require("http-status"));
const catchAsync_1 = __importDefault(require("../../util/catchAsync"));
const sendResponse_1 = __importDefault(require("../../util/sendResponse"));
const transaction_service_1 = require("./transaction.service");
// ! for adding new transaction
const addNewTransaction = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const result = yield transaction_service_1.transactionServices.addNewTransaction(req.body, (_a = req === null || req === void 0 ? void 0 : req.user) === null || _a === void 0 ? void 0 : _a.userId);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.CREATED,
        success: true,
        message: "Transaction added successfully!!! ",
        data: result,
    });
}));
// ! for adding new transaction as array data
const addManyTransaction = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const result = yield transaction_service_1.transactionServices.addManyTransaction(req.body, (_a = req === null || req === void 0 ? void 0 : req.user) === null || _a === void 0 ? void 0 : _a.userId);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.CREATED,
        success: true,
        message: "Transactions added successfully!!! ",
        data: result,
    });
}));
// ! Update transaction
const updateTransaction = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const result = yield transaction_service_1.transactionServices.updateTransaction((_a = req.params) === null || _a === void 0 ? void 0 : _a.transactionId, req === null || req === void 0 ? void 0 : req.body);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Transaction updated successfully",
        data: result,
    });
}));
// ! Get monthly transactions (default: current month)
const getMonthlyTransactions = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const result = yield transaction_service_1.transactionServices.getMonthlyTransactions((_a = req === null || req === void 0 ? void 0 : req.user) === null || _a === void 0 ? void 0 : _a.userId, req === null || req === void 0 ? void 0 : req.query);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: `Transactions retrived successfully !!!`,
        data: result,
    });
}));
// ! for getting the daily transaction
const getDailyTransactions = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const result = yield transaction_service_1.transactionServices.getDailyTransactions((_a = req === null || req === void 0 ? void 0 : req.user) === null || _a === void 0 ? void 0 : _a.userId);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: `Daily Transactions retrived !!!`,
        data: result,
    });
}));
// ! for getting the yearly transaction summary
const getYearlySummary = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const result = yield transaction_service_1.transactionServices.getYearlySummary((_a = req === null || req === void 0 ? void 0 : req.user) === null || _a === void 0 ? void 0 : _a.userId, req === null || req === void 0 ? void 0 : req.query);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: `yearly Transactions retrived !!!`,
        data: result,
    });
}));
// ! for getting the weekly transaction summary
const getWeeklySummary = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const result = yield transaction_service_1.transactionServices.getWeeklySummary((_a = req === null || req === void 0 ? void 0 : req.user) === null || _a === void 0 ? void 0 : _a.userId);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: `Weekly Transactions retrived !!!`,
        data: result,
    });
}));
// ! for deletig transaction data
const deleteTransactionData = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const result = yield transaction_service_1.transactionServices.deleteTransactionData((_a = req.params) === null || _a === void 0 ? void 0 : _a.transactionId);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Transaction Deleted successfully",
        data: result,
    });
}));
// ! for money management
const moneyManagement = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const result = yield transaction_service_1.transactionServices.moneyManagement((_a = req.body) === null || _a === void 0 ? void 0 : _a.prompt);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.CREATED,
        success: true,
        message: "Chat Completed",
        data: result,
    });
}));
//
exports.transactionControllers = {
    addNewTransaction,
    updateTransaction,
    deleteTransactionData,
    getDailyTransactions,
    getYearlySummary,
    getMonthlyTransactions,
    moneyManagement,
    addManyTransaction,
    getWeeklySummary,
};
