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
exports.spendingController = void 0;
const http_status_1 = __importDefault(require("http-status"));
const AppError_1 = __importDefault(require("../../Error/AppError"));
const catchAsync_1 = __importDefault(require("../../util/catchAsync"));
const sendResponse_1 = __importDefault(require("../../util/sendResponse"));
const spending_service_1 = require("./spending.service");
const getSpendingSummary = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const period = req.query.period;
    if (!period || !["month", "year", "lifetime"].includes(period)) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "period must be one of: month, year, lifetime");
    }
    const targetMonth = req.query.targetMonth;
    const targetYear = req.query.targetYear;
    const result = yield spending_service_1.spendingServices.getSpendingSummaryFromDB(req.params.bikeId, req.user.userId, period, targetMonth, targetYear);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Spending summary retrieved successfully",
        data: result,
    });
}));
const getSpendingTrend = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const targetYearRaw = req.query.targetYear;
    const monthsRaw = req.query.months;
    // ! spec 63: targetYear (a calendar Jan→Dec year) takes precedence over months (the
    // ! rolling window). Only one path runs; the other validation is skipped.
    let options;
    if (targetYearRaw) {
        const targetYear = parseInt(targetYearRaw, 10);
        if (isNaN(targetYear) || targetYear < 2000 || targetYear > 2100) {
            throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "targetYear must be a year between 2000 and 2100");
        }
        options = { targetYear };
    }
    else {
        const months = monthsRaw ? parseInt(monthsRaw, 10) : 3;
        if (isNaN(months) || months < 1 || months > 24) {
            throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "months must be a number between 1 and 24");
        }
        options = { months };
    }
    const result = yield spending_service_1.spendingServices.getSpendingTrendFromDB(req.params.bikeId, req.user.userId, options);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Spending trend retrieved successfully",
        data: result,
    });
}));
const getSpendingDetails = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const period = req.query.period;
    if (!period || !["month", "year", "lifetime"].includes(period)) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "period must be one of: month, year, lifetime");
    }
    const targetMonth = req.query.targetMonth;
    const targetYear = req.query.targetYear;
    const result = yield spending_service_1.spendingServices.getSpendingDetailsFromDB(req.params.bikeId, req.user.userId, period, targetMonth, targetYear);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Spending details retrieved successfully",
        data: result,
    });
}));
// ! Spec 60: month-only category drill-down for the app's Month tab. Unlike
// ! getSpendingSummary there is no `period` param — this endpoint is month-by-definition,
// ! so targetMonth is always required and no year/lifetime branch exists.
const getMonthlyBreakdown = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const targetMonth = req.query.targetMonth;
    if (!targetMonth) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "targetMonth is required. Use YYYY-MM");
    }
    const result = yield spending_service_1.spendingServices.getMonthlyCategoryBreakdownFromDB(req.params.bikeId, req.user.userId, targetMonth);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Monthly spending breakdown retrieved successfully",
        data: result,
    });
}));
// ! Spec 61: category drill-down for the Year and Lifetime tabs. A category expands to
// ! time buckets (per-month for a year, per-year for lifetime). `period` is year|lifetime
// ! only — the Month tab keeps its own /monthly-breakdown route. targetYear is required
// ! for period=year and ignored for lifetime.
const getPeriodBreakdown = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const period = req.query.period;
    if (!period || !["year", "lifetime"].includes(period)) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "period must be one of: year, lifetime");
    }
    const targetYear = req.query.targetYear;
    const result = yield spending_service_1.spendingServices.getPeriodCategoryBreakdownFromDB(req.params.bikeId, req.user.userId, period, targetYear);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Period spending breakdown retrieved successfully",
        data: result,
    });
}));
exports.spendingController = {
    getSpendingSummary,
    getSpendingTrend,
    getSpendingDetails,
    getMonthlyBreakdown,
    getPeriodBreakdown,
};
