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
const prisma_1 = require("../../lib/prisma");
const bike_utils_1 = require("../bike/bike.utils");
const bikeAccessory_constant_1 = require("../bikeAccessory/bikeAccessory.constant");
// ! shared by getSpendingSummaryFromDB and getSpendingDetailsFromDB so the two endpoints'
// ! date-range math can never drift apart from each other
const resolveSpendingDateRange = (period, targetMonth, targetYear) => {
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
        return {
            startDate: new Date(year, month - 1, 1, 0, 0, 0, 0),
            endDate: new Date(year, month, 0, 23, 59, 59, 999),
        };
    }
    if (period === "year") {
        if (!targetYear) {
            throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "targetYear is required for period=year");
        }
        const year = parseInt(targetYear, 10);
        if (isNaN(year) || year < 2000 || year > 2100) {
            throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "Invalid targetYear format. Use YYYY");
        }
        return {
            startDate: new Date(year, 0, 1, 0, 0, 0, 0),
            endDate: new Date(year, 11, 31, 23, 59, 59, 999),
        };
    }
    return {};
};
const computeSpendingForRange = (bikeId, startDate, endDate) => __awaiter(void 0, void 0, void 0, function* () {
    const [fuelLogs, maintenanceLogs, accessories, engineOilLogs] = yield Promise.all([
        prisma_1.prisma.fuelLog.findMany({
            where: Object.assign({ bikeId, isDeleted: false }, (startDate && endDate ? { date: { gte: startDate, lte: endDate } } : {})),
        }),
        prisma_1.prisma.maintenanceLog.findMany({
            where: Object.assign({ bikeId, isDeleted: false }, (startDate && endDate ? { serviceDate: { gte: startDate, lte: endDate } } : {})),
            // ! replaces Mongoose's .populate("maintenanceType", "name")
            include: { maintenanceType: { select: { name: true } } },
        }),
        // ! only purchased accessories count as real spending — pending/cancelled wishlist
        // ! entries are never included
        prisma_1.prisma.bikeAccessory.findMany({
            where: Object.assign({ bikeId, isDeleted: false, status: bikeAccessory_constant_1.AccessoryStatus.purchased }, (startDate && endDate ? { purchaseDate: { gte: startDate, lte: endDate } } : {})),
        }),
        // ! Spec 54 §F/D7: an oil change is its own record now, and the money is real — without
        // ! this the bike hub's totals would drop by the cost of every oil change ever logged
        // ! the moment the import soft-deletes the source maintenance logs.
        // ! §0 H3: between the import's --apply and its --finalize, oil is counted TWICE here
        // ! (once from the still-live maintenance log, once from the copy). That window is
        // ! read-only and minutes long inside one operator session — run copy, verify, finalize
        // ! in one sitting, and before the web client ships.
        prisma_1.prisma.engineOilLog.findMany({
            where: Object.assign({ bikeId, isDeleted: false }, (startDate && endDate ? { changeDate: { gte: startDate, lte: endDate } } : {})),
            include: { oilType: { select: { name: true } } },
        }),
    ]);
    // ! every Decimal(12,2) field read here MUST go through Number(...) before arithmetic —
    // ! a Prisma Decimal instance doesn't do real arithmetic through JS's +/* operators
    const fuelTotal = fuelLogs.reduce((sum, log) => sum + Number(log.totalCost), 0);
    const maintenanceByCategory = maintenanceLogs.reduce((acc, log) => {
        var _a, _b, _c;
        // ! maintenanceType is a required FK, so null shouldn't actually occur — the "Unknown"
        // ! fallback is defensive, matching pre-migration behavior rather than tightening it
        const category = (_b = (_a = log.maintenanceType) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "Unknown";
        acc[category] = ((_c = acc[category]) !== null && _c !== void 0 ? _c : 0) + Number(log.cost);
        return acc;
    }, {});
    const accessoryTotal = accessories.reduce((sum, a) => sum + (a.price ? Number(a.price) : 0), 0);
    const oilTotal = engineOilLogs.reduce((sum, log) => sum + Number(log.cost), 0);
    const categoryBreakdown = [
        { category: "Fuel", total: fuelTotal },
        ...Object.entries(maintenanceByCategory).map(([category, total]) => ({
            category,
            total,
        })),
        ...(accessoryTotal > 0 ? [{ category: "Accessories", total: accessoryTotal }] : []),
        // ! only when > 0, following the accessories precedent directly above
        ...(oilTotal > 0 ? [{ category: "Engine Oil", total: oilTotal }] : []),
    ];
    categoryBreakdown.sort((a, b) => b.total - a.total);
    const maintenanceTotal = maintenanceLogs.reduce((sum, log) => sum + Number(log.cost), 0);
    // ! easy to miss, because the category array above is built separately from this sum
    const totalSpending = fuelTotal + maintenanceTotal + accessoryTotal + oilTotal;
    const fuelRecords = fuelLogs.map((log) => {
        var _a, _b;
        return ({
            date: log.date,
            category: "Fuel",
            description: `${log.litersAdded}L${log.isFullTank ? " (Full Tank)" : ""} @ ৳${Number(log.pricePerLiter)}/L`,
            amount: Number(log.totalCost),
            vendor: (_a = log.fuelStation) !== null && _a !== void 0 ? _a : null,
            remarks: (_b = log.notes) !== null && _b !== void 0 ? _b : null,
            source: "fuel",
            liters: Number(log.litersAdded),
        });
    });
    const maintenanceRecords = maintenanceLogs.map((log) => {
        var _a, _b, _c, _d, _e;
        const category = (_b = (_a = log.maintenanceType) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "Unknown";
        return {
            date: log.serviceDate,
            category,
            description: ((_c = log.partsReplaced) === null || _c === void 0 ? void 0 : _c.length) ? log.partsReplaced.join(", ") : category,
            amount: Number(log.cost),
            vendor: (_d = log.serviceCenter) !== null && _d !== void 0 ? _d : null,
            remarks: (_e = log.notes) !== null && _e !== void 0 ? _e : null,
            source: "maintenance",
            liters: null,
        };
    });
    const accessoryRecords = accessories.map((a) => ({
        date: a.purchaseDate,
        category: "Accessories",
        description: a.name,
        amount: a.price !== null ? Number(a.price) : 0,
        vendor: null,
        remarks: null,
        source: "accessory",
        liters: null,
    }));
    const engineOilRecords = engineOilLogs.map((log) => {
        var _a, _b, _c, _d;
        return ({
            date: log.changeDate,
            category: "Engine Oil",
            description: ((_b = (_a = log.oilType) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "Engine oil") +
                (log.oilFilterChanged ? " · filter changed" : ""),
            amount: Number(log.cost),
            vendor: (_c = log.serviceCenter) !== null && _c !== void 0 ? _c : null,
            remarks: (_d = log.notes) !== null && _d !== void 0 ? _d : null,
            source: "oil",
            liters: null,
        });
    });
    const records = [
        ...fuelRecords,
        ...maintenanceRecords,
        ...accessoryRecords,
        ...engineOilRecords,
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return { totalSpending, categoryBreakdown, records };
});
const getSpendingSummaryFromDB = (bikeId, userId, period, targetMonth, targetYear) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const { startDate, endDate } = resolveSpendingDateRange(period, targetMonth, targetYear);
    const { totalSpending, categoryBreakdown } = yield computeSpendingForRange(bikeId, startDate, endDate);
    return Object.assign(Object.assign(Object.assign({ period }, (targetMonth ? { targetMonth } : {})), (targetYear ? { targetYear } : {})), { totalSpending,
        categoryBreakdown });
});
const getSpendingDetailsFromDB = (bikeId, userId, period, targetMonth, targetYear) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const { startDate, endDate } = resolveSpendingDateRange(period, targetMonth, targetYear);
    const { totalSpending, categoryBreakdown, records } = yield computeSpendingForRange(bikeId, startDate, endDate);
    return Object.assign(Object.assign(Object.assign({ period }, (targetMonth ? { targetMonth } : {})), (targetYear ? { targetYear } : {})), { totalSpending,
        categoryBreakdown,
        records });
});
// ! Spec 60: month-only category drill-down for the app's Month tab accordions.
// ! Reuses computeSpendingForRange (so the date math and per-record shape can never
// ! drift from the summary/details endpoints) and simply groups its flat records[] by
// ! category. The categories are derived from the records themselves rather than from
// ! categoryBreakdown: computeSpendingForRange always emits a `Fuel` breakdown row even
// ! at ৳0, and a zero-value bucket here would render as an accordion that expands to
// ! nothing. Grouping from records drops any category with no line items, and the per-
// ! category totals still sum to totalSpending because every cost lives in exactly one
// ! record.
const getMonthlyCategoryBreakdownFromDB = (bikeId, userId, targetMonth) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const { startDate, endDate } = resolveSpendingDateRange("month", targetMonth);
    const { totalSpending, records } = yield computeSpendingForRange(bikeId, startDate, endDate);
    const groups = new Map();
    for (const record of records) {
        const existing = groups.get(record.category);
        if (existing) {
            existing.total += record.amount;
            existing.records.push(record);
        }
        else {
            groups.set(record.category, {
                category: record.category,
                total: record.amount,
                records: [record],
            });
        }
    }
    const categories = [...groups.values()]
        .map((group) => (Object.assign(Object.assign({}, group), { 
        // ! newest-first inside a category: computeSpendingForRange sorts records
        // ! oldest-first (right for the PDF's chronological read, backwards for a
        // ! drill-down where the most recent spend is what the rider wants first)
        records: [...group.records].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()) })))
        .sort((a, b) => b.total - a.total);
    return {
        period: "month",
        targetMonth,
        totalSpending,
        categories,
    };
});
// ! Spec 61: category drill-down for the Year and Lifetime tabs. Same shape idea as spec
// ! 60's month breakdown, but a category expands to TIME BUCKETS, not individual records:
// ! per-month for a year, per-year for lifetime. Reuses computeSpendingForRange (so the
// ! date math and totals can never drift from the summary/details endpoints) and buckets
// ! its flat records[]. Fuel buckets carry summed litres; every other category's litres is
// ! null. Categories are derived from the records themselves — a ৳0 Fuel row never appears,
// ! matching spec 60's reasoning — and per-category totals still sum to totalSpending
// ! because every cost lives in exactly one record.
const getPeriodCategoryBreakdownFromDB = (bikeId, userId, period, targetYear) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const { startDate, endDate } = period === "year"
        ? resolveSpendingDateRange("year", undefined, targetYear)
        : resolveSpendingDateRange("lifetime");
    const { totalSpending, records } = yield computeSpendingForRange(bikeId, startDate, endDate);
    // ! bucketKey/bucketLabel decide the grain: a year drills into its 12 months, lifetime
    // ! into calendar years. Both derive from the record's own date so an out-of-range row
    // ! can never land in the wrong bucket.
    const monthLabels = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
    ];
    const groups = new Map();
    for (const record of records) {
        const date = new Date(record === null || record === void 0 ? void 0 : record.date);
        const year = date.getFullYear();
        const month = date.getMonth(); // 0-11
        const bucketKey = period === "year"
            ? `${year}-${String(month + 1).padStart(2, "0")}`
            : `${year}`;
        const bucketLabel = period === "year" ? monthLabels[month] : `${year}`;
        let group = groups.get(record === null || record === void 0 ? void 0 : record.category);
        if (!group) {
            group = { category: record === null || record === void 0 ? void 0 : record.category, total: 0, buckets: new Map() };
            groups.set(record === null || record === void 0 ? void 0 : record.category, group);
        }
        group.total += (_a = record === null || record === void 0 ? void 0 : record.amount) !== null && _a !== void 0 ? _a : 0;
        let bucket = group.buckets.get(bucketKey);
        if (!bucket) {
            bucket = { key: bucketKey, label: bucketLabel, total: 0, liters: null };
            group.buckets.set(bucketKey, bucket);
        }
        bucket.total += (_b = record === null || record === void 0 ? void 0 : record.amount) !== null && _b !== void 0 ? _b : 0;
        if ((record === null || record === void 0 ? void 0 : record.liters) != null) {
            bucket.liters = ((_c = bucket === null || bucket === void 0 ? void 0 : bucket.liters) !== null && _c !== void 0 ? _c : 0) + (record === null || record === void 0 ? void 0 : record.liters);
        }
    }
    const categories = [...groups.values()]
        .map((group) => {
        const buckets = [...group.buckets.values()].sort((a, b) => 
        // ! year view: months chronological (Jan→Dec). lifetime: years newest-first.
        period === "year"
            ? a === null || a === void 0 ? void 0 : a.key.localeCompare(b === null || b === void 0 ? void 0 : b.key)
            : b === null || b === void 0 ? void 0 : b.key.localeCompare(a === null || a === void 0 ? void 0 : a.key));
        const totalLiters = buckets.reduce((sum, b) => ((b === null || b === void 0 ? void 0 : b.liters) != null ? (sum !== null && sum !== void 0 ? sum : 0) + (b === null || b === void 0 ? void 0 : b.liters) : sum), null);
        return {
            category: group === null || group === void 0 ? void 0 : group.category,
            total: group === null || group === void 0 ? void 0 : group.total,
            totalLiters,
            buckets,
        };
    })
        .sort((a, b) => (b === null || b === void 0 ? void 0 : b.total) - (a === null || a === void 0 ? void 0 : a.total));
    return Object.assign(Object.assign({ period }, (targetYear ? { targetYear } : {})), { totalSpending,
        categories });
});
const getSpendingTrendFromDB = (bikeId, userId, 
// ! spec 63: `targetYear` returns a fixed calendar year Jan→Dec (the app Trend tab);
// ! `months` is the original rolling last-N-months window. Exactly one is set — the
// ! controller decides. Additive: a caller passing only `months` (the web client) is
// ! unchanged.
options) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const monthlySummary = [];
    if (options.targetYear != null) {
        const year = options.targetYear;
        for (let month = 1; month <= 12; month++) {
            const targetMonth = `${year}-${String(month).padStart(2, "0")}`;
            const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
            const endDate = new Date(year, month, 0, 23, 59, 59, 999);
            const { totalSpending, categoryBreakdown } = yield computeSpendingForRange(bikeId, startDate, endDate);
            monthlySummary.push({ targetMonth, totalSpending, categoryBreakdown });
        }
        return { targetYear: year.toString(), months: 12, monthlySummary };
    }
    const months = (_a = options.months) !== null && _a !== void 0 ? _a : 3;
    const now = new Date();
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
    computeSpendingForRange,
    getSpendingSummaryFromDB,
    getSpendingTrendFromDB,
    getSpendingDetailsFromDB,
    getMonthlyCategoryBreakdownFromDB,
    getPeriodCategoryBreakdownFromDB,
};
