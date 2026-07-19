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
exports.mileageRecordServices = void 0;
const fuelLog_model_1 = require("../fuelLog/fuelLog.model");
const mileageRecord_model_1 = require("./mileageRecord.model");
const bike_model_1 = require("../bike/bike.model");
const http_status_1 = __importDefault(require("http-status"));
const AppError_1 = __importDefault(require("../../Error/AppError"));
const computeMileageForRange = (bikeId, startDate, endDate) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const fuelLogsInRange = yield fuelLog_model_1.fuelLogModel
        .find({
        bike: bikeId,
        date: { $gte: startDate, $lte: endDate },
        isDeleted: false,
    })
        .sort({ date: 1 })
        .lean();
    if (fuelLogsInRange.length === 0) {
        return { totalDistanceKm: 0, totalLitersConsumed: 0, fuelLogCount: 0 };
    }
    const lastLogInRange = fuelLogsInRange[fuelLogsInRange.length - 1];
    const previousLog = yield fuelLog_model_1.fuelLogModel
        .findOne({
        bike: bikeId,
        date: { $lt: startDate },
        isDeleted: false,
    })
        .sort({ date: -1 })
        .lean();
    let startOdometer;
    if (previousLog) {
        startOdometer = previousLog.odometerReading;
    }
    else {
        // ! no earlier fuel log — anchor on the bike's immutable initialOdometer, not
        // ! currentOdometer (which reflects TODAY's reading, not the reading as of this
        // ! historical range's start, once any later fuel/maintenance log has bumped it)
        const bike = yield bike_model_1.bikeModel.findById(bikeId).lean();
        startOdometer = (_a = bike === null || bike === void 0 ? void 0 : bike.initialOdometer) !== null && _a !== void 0 ? _a : 0;
    }
    const totalDistanceKm = lastLogInRange.odometerReading - startOdometer;
    const totalLitersConsumed = fuelLogsInRange.reduce((sum, log) => sum + log.litersAdded, 0);
    const fuelLogCount = fuelLogsInRange.length;
    return { totalDistanceKm, totalLitersConsumed, fuelLogCount };
});
// ! how many recent fuel logs feed the rolling-average fallback (plan §2.1) — this must be
// ! computed from raw FuelLogs regardless of isFullTank, not from existing MileageRecords,
// ! otherwise a user who never does a full-tank fill would never get any mileage figure at all
const ROLLING_AVERAGE_WINDOW = 10;
const getMileageRecordsFromDB = (bikeId) => __awaiter(void 0, void 0, void 0, function* () {
    const exactRecords = yield mileageRecord_model_1.mileageRecordModel
        .find({ bike: bikeId })
        .sort({ periodEndDate: -1 })
        .lean();
    const recentFuelLogs = yield fuelLog_model_1.fuelLogModel
        .find({ bike: bikeId, isDeleted: false })
        .sort({ date: -1 })
        .limit(ROLLING_AVERAGE_WINDOW)
        .lean();
    let approximate = null;
    if (recentFuelLogs.length >= 2) {
        const chronological = [...recentFuelLogs].sort((a, b) => a.date.getTime() - b.date.getTime());
        const distanceKm = chronological[chronological.length - 1].odometerReading -
            chronological[0].odometerReading;
        const litersConsumed = chronological.reduce((sum, log) => sum + log.litersAdded, 0);
        if (litersConsumed > 0 && distanceKm > 0) {
            approximate = {
                mileageKmPerLiter: distanceKm / litersConsumed,
                basedOnFuelLogCount: chronological.length,
                isEstimate: true,
            };
        }
    }
    return { exactRecords, approximate };
});
const getMonthlyMileageFromDB = (bikeId, targetMonth) => __awaiter(void 0, void 0, void 0, function* () {
    const [yearStr, monthStr] = targetMonth.split("-");
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    if (isNaN(year) ||
        isNaN(month) ||
        month < 1 ||
        month > 12 ||
        year < 2000 ||
        year > 2100) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "Invalid targetMonth format. Use YYYY-MM");
    }
    const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);
    const summary = yield computeMileageForRange(bikeId, startDate, endDate);
    return Object.assign({ targetMonth }, summary);
});
const getYearlyMileageFromDB = (bikeId, targetYear) => __awaiter(void 0, void 0, void 0, function* () {
    const year = parseInt(targetYear, 10);
    if (isNaN(year) || year < 2000 || year > 2100) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "Invalid targetYear format. Use YYYY");
    }
    const monthlySummary = [];
    for (let month = 1; month <= 12; month++) {
        const monthStr = month.toString().padStart(2, "0");
        const targetMonth = `${year}-${monthStr}`;
        const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
        const endDate = new Date(year, month, 0, 23, 59, 59, 999);
        const summary = yield computeMileageForRange(bikeId, startDate, endDate);
        monthlySummary.push(Object.assign({ targetMonth }, summary));
    }
    return { targetYear, monthlySummary };
});
const getLifetimeMileageFromDB = (bikeId) => __awaiter(void 0, void 0, void 0, function* () {
    const bike = yield bike_model_1.bikeModel.findById(bikeId).lean();
    if (!bike) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike not found");
    }
    const latestFuelLog = yield fuelLog_model_1.fuelLogModel
        .findOne({ bike: bikeId, isDeleted: false })
        .sort({ date: -1 })
        .lean();
    if (!latestFuelLog) {
        return { totalDistanceKm: 0, totalLitersConsumed: 0, fuelLogCount: 0 };
    }
    // ! anchor on the bike's immutable initialOdometer (odometer at purchase/registration),
    // ! not the first fuel log's reading — the plan doc's "lifetime" figure is meant to cover
    // ! since-purchase distance, including any km ridden before the first fuel log was ever entered
    const endOdometer = latestFuelLog.odometerReading;
    const allLogs = yield fuelLog_model_1.fuelLogModel
        .find({ bike: bikeId, isDeleted: false })
        .sort({ date: 1 })
        .lean();
    const totalDistanceKm = endOdometer - bike.initialOdometer;
    const totalLitersConsumed = allLogs.reduce((sum, log) => sum + log.litersAdded, 0);
    const fuelLogCount = allLogs.length;
    return { totalDistanceKm, totalLitersConsumed, fuelLogCount };
});
exports.mileageRecordServices = {
    getMileageRecordsFromDB,
    getMonthlyMileageFromDB,
    getYearlyMileageFromDB,
    getLifetimeMileageFromDB,
};
