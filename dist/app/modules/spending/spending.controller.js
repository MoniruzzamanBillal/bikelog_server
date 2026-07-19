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
exports.spendingController = {
    getSpendingSummary,
};
