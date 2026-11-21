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
Object.defineProperty(exports, "__esModule", { value: true });
exports.bikeStatsServices = void 0;
const bike_utils_1 = require("../bike/bike.utils");
const engineOilLog_service_1 = require("../engineOilLog/engineOilLog.service");
const mileageRecord_service_1 = require("../mileageRecord/mileageRecord.service");
const spending_service_1 = require("../spending/spending.service");
// ! Decision 3: mean of the 5 most-recent exact MileageRecords by periodEndDate desc
// ! (getMileageRecordsFromDB already returns exactRecords in that order). Lifted verbatim
// ! from the client so the value is byte-identical to today's strip.
const AVG_MILEAGE_WINDOW = 5;
// ! date-fns is not a server dependency (see spending.service.ts), so build the "YYYY-MM"
// ! label the same way the composed services do internally.
const currentMonthString = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};
// ! Decision 4 / §Query: validate `targetMonth` loosely — a bad value falls back to the
// ! current month rather than 400 (the endpoint is additive and non-breaking). The bounds
// ! mirror resolveSpendingDateRange's, so a value that passes here never makes that helper
// ! throw downstream.
const isValidMonth = (month) => {
    if (!month || !/^\d{4}-\d{2}$/.test(month))
        return false;
    const [year, mon] = month.split("-").map(Number);
    return year >= 2000 && year <= 2100 && mon >= 1 && mon <= 12;
};
const getBikeStatStripFromDB = (bikeId, userId, targetMonth) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    // ! Decision 7: one ownership guard up front — it both enforces access and yields the bike
    // ! row for costPerKm. The composed services each re-guard internally (a few cheap indexed
    // ! reads), accepted for the simplicity of reusing the high-level services.
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const month = isValidMonth(targetMonth) ? targetMonth : currentMonthString();
    // ! Decision 8: the four composed calls are independent → Promise.all, so latency is one
    // ! slow call, not the sum. Decision 2: compose the existing exported services, so each
    // ! number has a single source of truth and can never drift from its drill-down screen.
    const [mileage, monthSummary, lifetimeSummary, oilStatus] = yield Promise.all([
        mileageRecord_service_1.mileageRecordServices.getMileageRecordsFromDB(bikeId),
        spending_service_1.spendingServices.getSpendingSummaryFromDB(bikeId, userId, "month", month),
        spending_service_1.spendingServices.getSpendingSummaryFromDB(bikeId, userId, "lifetime"),
        engineOilLog_service_1.engineOilLogServices.getEngineOilStatusFromDB(bikeId, userId),
    ]);
    // ! Decision 3
    const recent = mileage.exactRecords.slice(0, AVG_MILEAGE_WINDOW);
    const avgMileageKmPerLiter = recent.length > 0
        ? recent.reduce((sum, r) => sum + r.mileageKmPerLiter, 0) / recent.length
        : ((_b = (_a = mileage.approximate) === null || _a === void 0 ? void 0 : _a.mileageKmPerLiter) !== null && _b !== void 0 ? _b : null);
    const lifetimeSpending = lifetimeSummary.totalSpending;
    // ! Decision 6: costPerKm from the owned bike's odometer delta; null when the delta <= 0
    // ! (no divide-by-zero, matching both clients' current formula).
    const odometerDelta = bike.currentOdometer - bike.initialOdometer;
    const costPerKm = odometerDelta > 0 ? lifetimeSpending / odometerDelta : null;
    // ! Decision 5: oil scalars are null when and ONLY when there is no oil change on record
    // ! (lastChange === null). With a change on record the numbers carry through — including a
    // ! legitimate 0 — and the `?? null` also covers an imported change that has no interval
    // ! (percentUsed omitted upstream), mirroring the client's `oilStatus?.lastChange ? … : null` gate.
    const hasOilChange = oilStatus.lastChange !== null;
    const oil = {
        kmSinceChange: hasOilChange ? ((_c = oilStatus.kmSinceChange) !== null && _c !== void 0 ? _c : null) : null,
        percentUsed: hasOilChange ? ((_d = oilStatus.percentUsed) !== null && _d !== void 0 ? _d : null) : null,
    };
    return {
        avgMileageKmPerLiter,
        monthSpending: monthSummary.totalSpending,
        lifetimeSpending,
        costPerKm,
        oil,
    };
});
exports.bikeStatsServices = {
    getBikeStatStripFromDB,
};
