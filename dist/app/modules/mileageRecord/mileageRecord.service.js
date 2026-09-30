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
const http_status_1 = __importDefault(require("http-status"));
const AppError_1 = __importDefault(require("../../Error/AppError"));
const prisma_1 = require("../../lib/prisma");
const toApiShape = (record) => (Object.assign(Object.assign({}, record), { _id: record.id, bike: record.bikeId }));
const computeMileageForRange = (bikeId, startDate, endDate) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const fuelLogsInRange = yield prisma_1.prisma.fuelLog.findMany({
        where: { bikeId, date: { gte: startDate, lte: endDate }, isDeleted: false },
        orderBy: { date: "asc" },
    });
    if (fuelLogsInRange.length === 0) {
        return { totalDistanceKm: 0, totalLitersConsumed: 0, fuelLogCount: 0 };
    }
    const lastLogInRange = fuelLogsInRange[fuelLogsInRange.length - 1];
    const previousLog = yield prisma_1.prisma.fuelLog.findFirst({
        where: { bikeId, date: { lt: startDate }, isDeleted: false },
        orderBy: { date: "desc" },
    });
    let startOdometer;
    if (previousLog) {
        startOdometer = previousLog.odometerReading;
    }
    else {
        // ! no earlier fuel log — anchor on the bike's immutable initialOdometer, not
        // ! currentOdometer (which reflects TODAY's reading, not the reading as of this
        // ! historical range's start, once any later fuel/maintenance log has bumped it)
        const bike = yield prisma_1.prisma.bike.findUnique({ where: { id: bikeId } });
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
// spec 39: fuel-efficiency anomaly flag
const MIN_PRIOR_PERIODS_FOR_ALERT = 3; // need at least 3 prior periods before ever flagging — 1-2 samples have no real baseline
const ROLLING_WINDOW_FOR_ALERT = 5; // average of the prior 5 periods, floored to whatever's available down to the minimum
const ANOMALY_DROP_THRESHOLD = 0.85; // latest < average * 0.85 == a >15% drop (strict <, the boundary itself does not flag)
const computeEfficiencyAlert = (exactRecords) => {
    if (exactRecords.length < MIN_PRIOR_PERIODS_FOR_ALERT + 1)
        return null;
    const [latest, ...prior] = exactRecords;
    const windowed = prior.slice(0, ROLLING_WINDOW_FOR_ALERT);
    const rollingAverageKmPerLiter = windowed.reduce((sum, r) => sum + r.mileageKmPerLiter, 0) / windowed.length;
    const percentChange = (latest.mileageKmPerLiter - rollingAverageKmPerLiter) / rollingAverageKmPerLiter;
    return {
        isAnomaly: latest.mileageKmPerLiter < rollingAverageKmPerLiter * ANOMALY_DROP_THRESHOLD,
        latestKmPerLiter: latest.mileageKmPerLiter,
        rollingAverageKmPerLiter,
        percentChange,
        periodsUsed: windowed.length,
    };
};
const getMileageRecordsFromDB = (bikeId) => __awaiter(void 0, void 0, void 0, function* () {
    const exactRecords = yield prisma_1.prisma.mileageRecord.findMany({
        where: { bikeId },
        orderBy: { periodEndDate: "desc" },
    });
    const recentFuelLogs = yield prisma_1.prisma.fuelLog.findMany({
        where: { bikeId, isDeleted: false },
        orderBy: { date: "desc" },
        take: ROLLING_AVERAGE_WINDOW,
    });
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
    return {
        exactRecords: exactRecords.map(toApiShape),
        approximate,
        efficiencyAlert: computeEfficiencyAlert(exactRecords),
    };
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
    const bike = yield prisma_1.prisma.bike.findUnique({ where: { id: bikeId } });
    if (!bike) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike not found");
    }
    const latestFuelLog = yield prisma_1.prisma.fuelLog.findFirst({
        where: { bikeId, isDeleted: false },
        orderBy: { date: "desc" },
    });
    if (!latestFuelLog) {
        return { totalDistanceKm: 0, totalLitersConsumed: 0, fuelLogCount: 0 };
    }
    // ! anchor on the bike's immutable initialOdometer (odometer at purchase/registration),
    // ! not the first fuel log's reading — the plan doc's "lifetime" figure is meant to cover
    // ! since-purchase distance, including any km ridden before the first fuel log was ever entered
    const endOdometer = latestFuelLog.odometerReading;
    const allLogs = yield prisma_1.prisma.fuelLog.findMany({
        where: { bikeId, isDeleted: false },
        orderBy: { date: "asc" },
    });
    const totalDistanceKm = endOdometer - bike.initialOdometer;
    const totalLitersConsumed = allLogs.reduce((sum, log) => sum + log.litersAdded, 0);
    const fuelLogCount = allLogs.length;
    return { totalDistanceKm, totalLitersConsumed, fuelLogCount };
});
const getMileageTrendFromDB = (bikeId, months) => __awaiter(void 0, void 0, void 0, function* () {
    const now = new Date();
    const monthlySummary = [];
    for (let i = months - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const year = d.getFullYear();
        const month = d.getMonth() + 1;
        const targetMonth = `${year}-${String(month).padStart(2, "0")}`;
        const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
        const endDate = new Date(year, month, 0, 23, 59, 59, 999);
        const summary = yield computeMileageForRange(bikeId, startDate, endDate);
        monthlySummary.push(Object.assign({ targetMonth }, summary));
    }
    return { months, monthlySummary };
});
exports.mileageRecordServices = {
    computeMileageForRange,
    getMileageRecordsFromDB,
    getMonthlyMileageFromDB,
    getYearlyMileageFromDB,
    getLifetimeMileageFromDB,
    getMileageTrendFromDB,
};
