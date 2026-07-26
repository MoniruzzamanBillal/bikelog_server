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
exports.spendingServices = void 0;
const http_status_1 = __importDefault(require("http-status"));
const AppError_1 = __importDefault(require("../../Error/AppError"));
const bike_utils_1 = require("../bike/bike.utils");
const fuelLog_model_1 = require("../fuelLog/fuelLog.model");
const maintenanceLog_model_1 = require("../maintenanceLog/maintenanceLog.model");
const computeSpendingForRange = (bikeId, startDate, endDate) => __awaiter(void 0, void 0, void 0, function* () {
    const fuelLogsPromise = fuelLog_model_1.fuelLogModel
        .find(Object.assign({ bike: bikeId, isDeleted: false }, (startDate && endDate ? { date: { $gte: startDate, $lte: endDate } } : {})))
        .lean();
    const maintenanceLogsPromise = maintenanceLog_model_1.maintenanceLogModel
        .find(Object.assign({ bike: bikeId, isDeleted: false }, (startDate && endDate ? { serviceDate: { $gte: startDate, $lte: endDate } } : {})))
        .populate("maintenanceType", "name")
        .lean();
    const [fuelLogs, maintenanceLogs] = yield Promise.all([
        fuelLogsPromise,
        maintenanceLogsPromise,
    ]);
    const fuelTotal = fuelLogs.reduce((sum, log) => sum + log.totalCost, 0);
    const maintenanceByCategory = maintenanceLogs.reduce((acc, log) => {
        var _a, _b;
        const mt = log.maintenanceType;
        const category = (_a = mt === null || mt === void 0 ? void 0 : mt.name) !== null && _a !== void 0 ? _a : "Unknown";
        acc[category] = ((_b = acc[category]) !== null && _b !== void 0 ? _b : 0) + log.cost;
        return acc;
    }, {});
    const categoryBreakdown = [
        { category: "Fuel", total: fuelTotal },
        ...Object.entries(maintenanceByCategory).map(([category, total]) => ({
            category,
            total,
        })),
    ];
    categoryBreakdown.sort((a, b) => b.total - a.total);
    const maintenanceTotal = maintenanceLogs.reduce((sum, log) => sum + log.cost, 0);
    const totalSpending = fuelTotal + maintenanceTotal;
    return { totalSpending, categoryBreakdown };
});
const getSpendingSummaryFromDB = (bikeId, userId, period, targetMonth, targetYear) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    let startDate;
    let endDate;
    if (period === "month") {
        if (!targetMonth) {
            throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "targetMonth is required for period=month");
        }
        const [yearStr, monthStr] = targetMonth.split("-");
        const year = parseInt(yearStr, 10);
        const month = parseInt(monthStr, 10);
        if (isNaN(year) || isNaN(month) || month < 1 || month > 12 || year < 2000 || year > 2100) {
            throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "Invalid targetMonth format. Use YYYY-MM");
        }
        startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
        endDate = new Date(year, month, 0, 23, 59, 59, 999);
    }
    else if (period === "year") {
        if (!targetYear) {
            throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "targetYear is required for period=year");
        }
        const year = parseInt(targetYear, 10);
        if (isNaN(year) || year < 2000 || year > 2100) {
            throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "Invalid targetYear format. Use YYYY");
        }
        startDate = new Date(year, 0, 1, 0, 0, 0, 0);
        endDate = new Date(year, 11, 31, 23, 59, 59, 999);
    }
    const { totalSpending, categoryBreakdown } = yield computeSpendingForRange(bikeId, startDate, endDate);
    return Object.assign(Object.assign(Object.assign({ period }, (targetMonth ? { targetMonth } : {})), (targetYear ? { targetYear } : {})), { totalSpending,
        categoryBreakdown });
});
const getSpendingTrendFromDB = (bikeId, userId, months) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const now = new Date();
    const monthlySummary = [];
    for (let i = months - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const year = d.getFullYear();
        const month = d.getMonth() + 1;
        const targetMonth = `${year}-${String(month).padStart(2, "0")}`;
        const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
        const endDate = new Date(year, month, 0, 23, 59, 59, 999);
        const { totalSpending, categoryBreakdown } = yield computeSpendingForRange(bikeId, startDate, endDate);
        monthlySummary.push({ targetMonth, totalSpending, categoryBreakdown });
    }
    return { months, monthlySummary };
});
exports.spendingServices = {
    getSpendingSummaryFromDB,
    getSpendingTrendFromDB,
};
