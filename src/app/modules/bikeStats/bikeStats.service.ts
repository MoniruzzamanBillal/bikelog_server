import { findOwnedBikeOrThrow } from "../bike/bike.utils";
import { engineOilLogServices } from "../engineOilLog/engineOilLog.service";
import { mileageRecordServices } from "../mileageRecord/mileageRecord.service";
import { spendingServices } from "../spending/spending.service";
import { TBikeStatStrip } from "./bikeStats.interface";

// ! Decision 3: mean of the 5 most-recent exact MileageRecords by periodEndDate desc
// ! (getMileageRecordsFromDB already returns exactRecords in that order). Lifted verbatim
// ! from the client so the value is byte-identical to today's strip.
const AVG_MILEAGE_WINDOW = 5;

// ! date-fns is not a server dependency (see spending.service.ts), so build the "YYYY-MM"
// ! label the same way the composed services do internally.
const currentMonthString = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

// ! Decision 4 / §Query: validate `targetMonth` loosely — a bad value falls back to the
// ! current month rather than 400 (the endpoint is additive and non-breaking). The bounds
// ! mirror resolveSpendingDateRange's, so a value that passes here never makes that helper
// ! throw downstream.
const isValidMonth = (month?: string): month is string => {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return false;
  const [year, mon] = month.split("-").map(Number);
  return year >= 2000 && year <= 2100 && mon >= 1 && mon <= 12;
};

const getBikeStatStripFromDB = async (
  bikeId: string,
  userId: string,
  targetMonth?: string,
): Promise<TBikeStatStrip> => {
  // ! Decision 7: one ownership guard up front — it both enforces access and yields the bike
  // ! row for costPerKm. The composed services each re-guard internally (a few cheap indexed
  // ! reads), accepted for the simplicity of reusing the high-level services.
  const bike = await findOwnedBikeOrThrow(bikeId, userId);

  const month = isValidMonth(targetMonth) ? targetMonth : currentMonthString();

  // ! Decision 8: the four composed calls are independent → Promise.all, so latency is one
  // ! slow call, not the sum. Decision 2: compose the existing exported services, so each
  // ! number has a single source of truth and can never drift from its drill-down screen.
  const [mileage, monthSummary, lifetimeSummary, oilStatus] = await Promise.all([
    mileageRecordServices.getMileageRecordsFromDB(bikeId),
    spendingServices.getSpendingSummaryFromDB(bikeId, userId, "month", month),
    spendingServices.getSpendingSummaryFromDB(bikeId, userId, "lifetime"),
    engineOilLogServices.getEngineOilStatusFromDB(bikeId, userId),
  ]);

  // ! Decision 3
  const recent = mileage.exactRecords.slice(0, AVG_MILEAGE_WINDOW);
  const avgMileageKmPerLiter =
    recent.length > 0
      ? recent.reduce((sum, r) => sum + r.mileageKmPerLiter, 0) / recent.length
      : (mileage.approximate?.mileageKmPerLiter ?? null);

  const lifetimeSpending = lifetimeSummary.totalSpending;

  // ! Decision 6: costPerKm from the owned bike's odometer delta; null when the delta <= 0
  // ! (no divide-by-zero, matching both clients' current formula).
  const odometerDelta = bike.currentOdometer - bike.initialOdometer;
  const costPerKm =
    odometerDelta > 0 ? lifetimeSpending / odometerDelta : null;

  // ! Decision 5: oil scalars are null when and ONLY when there is no oil change on record
  // ! (lastChange === null). With a change on record the numbers carry through — including a
  // ! legitimate 0 — and the `?? null` also covers an imported change that has no interval
  // ! (percentUsed omitted upstream), mirroring the client's `oilStatus?.lastChange ? … : null` gate.
  const hasOilChange = oilStatus.lastChange !== null;
  const oil = {
    kmSinceChange: hasOilChange ? (oilStatus.kmSinceChange ?? null) : null,
    percentUsed: hasOilChange ? (oilStatus.percentUsed ?? null) : null,
  };

  return {
    avgMileageKmPerLiter,
    monthSpending: monthSummary.totalSpending,
    lifetimeSpending,
    costPerKm,
    oil,
  };
};

export const bikeStatsServices = {
  getBikeStatStripFromDB,
};
