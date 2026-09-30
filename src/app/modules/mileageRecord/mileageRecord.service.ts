import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import { prisma } from "../../lib/prisma";
import { TEfficiencyAlert } from "./mileageRecord.interface";

interface MileageSummary {
  totalDistanceKm: number;
  totalLitersConsumed: number;
  fuelLogCount: number;
}

interface MonthlyMileageResult extends MileageSummary {
  targetMonth: string;
}

interface YearlyMileageResult {
  targetYear: string;
  monthlySummary: MonthlyMileageResult[];
}

interface LifetimeMileageResult extends MileageSummary {}

interface TrendMileageResult {
  months: number;
  monthlySummary: MonthlyMileageResult[];
}

const toApiShape = <T extends { id: string; bikeId: string }>(record: T) => ({
  ...record,
  _id: record.id,
  bike: record.bikeId,
});

const computeMileageForRange = async (
  bikeId: string,
  startDate: Date,
  endDate: Date,
): Promise<MileageSummary> => {
  const fuelLogsInRange = await prisma.fuelLog.findMany({
    where: { bikeId, date: { gte: startDate, lte: endDate }, isDeleted: false },
    orderBy: { date: "asc" },
  });

  if (fuelLogsInRange.length === 0) {
    return { totalDistanceKm: 0, totalLitersConsumed: 0, fuelLogCount: 0 };
  }

  const lastLogInRange = fuelLogsInRange[fuelLogsInRange.length - 1];

  const previousLog = await prisma.fuelLog.findFirst({
    where: { bikeId, date: { lt: startDate }, isDeleted: false },
    orderBy: { date: "desc" },
  });

  let startOdometer: number;
  if (previousLog) {
    startOdometer = previousLog.odometerReading;
  } else {
    // ! no earlier fuel log — anchor on the bike's immutable initialOdometer, not
    // ! currentOdometer (which reflects TODAY's reading, not the reading as of this
    // ! historical range's start, once any later fuel/maintenance log has bumped it)
    const bike = await prisma.bike.findUnique({ where: { id: bikeId } });
    startOdometer = bike?.initialOdometer ?? 0;
  }

  const totalDistanceKm = lastLogInRange.odometerReading - startOdometer;
  const totalLitersConsumed = fuelLogsInRange.reduce(
    (sum, log) => sum + log.litersAdded,
    0,
  );
  const fuelLogCount = fuelLogsInRange.length;

  return { totalDistanceKm, totalLitersConsumed, fuelLogCount };
};

// ! how many recent fuel logs feed the rolling-average fallback (plan §2.1) — this must be
// ! computed from raw FuelLogs regardless of isFullTank, not from existing MileageRecords,
// ! otherwise a user who never does a full-tank fill would never get any mileage figure at all
const ROLLING_AVERAGE_WINDOW = 10;

// spec 39: fuel-efficiency anomaly flag
const MIN_PRIOR_PERIODS_FOR_ALERT = 3; // need at least 3 prior periods before ever flagging — 1-2 samples have no real baseline
const ROLLING_WINDOW_FOR_ALERT = 5; // average of the prior 5 periods, floored to whatever's available down to the minimum
const ANOMALY_DROP_THRESHOLD = 0.85; // latest < average * 0.85 == a >15% drop (strict <, the boundary itself does not flag)

const computeEfficiencyAlert = (
  exactRecords: { mileageKmPerLiter: number }[], // already sorted periodEndDate desc
): TEfficiencyAlert | null => {
  if (exactRecords.length < MIN_PRIOR_PERIODS_FOR_ALERT + 1) return null;

  const [latest, ...prior] = exactRecords;
  const windowed = prior.slice(0, ROLLING_WINDOW_FOR_ALERT);
  const rollingAverageKmPerLiter =
    windowed.reduce((sum, r) => sum + r.mileageKmPerLiter, 0) / windowed.length;
  const percentChange =
    (latest.mileageKmPerLiter - rollingAverageKmPerLiter) / rollingAverageKmPerLiter;

  return {
    isAnomaly:
      latest.mileageKmPerLiter < rollingAverageKmPerLiter * ANOMALY_DROP_THRESHOLD,
    latestKmPerLiter: latest.mileageKmPerLiter,
    rollingAverageKmPerLiter,
    percentChange,
    periodsUsed: windowed.length,
  };
};

const getMileageRecordsFromDB = async (bikeId: string) => {
  const exactRecords = await prisma.mileageRecord.findMany({
    where: { bikeId },
    orderBy: { periodEndDate: "desc" },
  });

  const recentFuelLogs = await prisma.fuelLog.findMany({
    where: { bikeId, isDeleted: false },
    orderBy: { date: "desc" },
    take: ROLLING_AVERAGE_WINDOW,
  });

  let approximate: {
    mileageKmPerLiter: number;
    basedOnFuelLogCount: number;
    isEstimate: true;
  } | null = null;

  if (recentFuelLogs.length >= 2) {
    const chronological = [...recentFuelLogs].sort(
      (a, b) => a.date.getTime() - b.date.getTime(),
    );
    const distanceKm =
      chronological[chronological.length - 1].odometerReading -
      chronological[0].odometerReading;
    const litersConsumed = chronological.reduce(
      (sum, log) => sum + log.litersAdded,
      0,
    );
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
};

const getMonthlyMileageFromDB = async (
  bikeId: string,
  targetMonth: string,
): Promise<MonthlyMileageResult> => {
  const [yearStr, monthStr] = targetMonth.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);

  if (
    isNaN(year) ||
    isNaN(month) ||
    month < 1 ||
    month > 12 ||
    year < 2000 ||
    year > 2100
  ) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid targetMonth format. Use YYYY-MM");
  }

  const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const endDate = new Date(year, month, 0, 23, 59, 59, 999);

  const summary = await computeMileageForRange(bikeId, startDate, endDate);

  return {
    targetMonth,
    ...summary,
  };
};

const getYearlyMileageFromDB = async (
  bikeId: string,
  targetYear: string,
): Promise<YearlyMileageResult> => {
  const year = parseInt(targetYear, 10);

  if (isNaN(year) || year < 2000 || year > 2100) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid targetYear format. Use YYYY");
  }

  const monthlySummary: MonthlyMileageResult[] = [];

  for (let month = 1; month <= 12; month++) {
    const monthStr = month.toString().padStart(2, "0");
    const targetMonth = `${year}-${monthStr}`;

    const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    const summary = await computeMileageForRange(bikeId, startDate, endDate);

    monthlySummary.push({
      targetMonth,
      ...summary,
    });
  }

  return { targetYear, monthlySummary };
};

const getLifetimeMileageFromDB = async (
  bikeId: string,
): Promise<LifetimeMileageResult> => {
  const bike = await prisma.bike.findUnique({ where: { id: bikeId } });
  if (!bike) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike not found");
  }

  const latestFuelLog = await prisma.fuelLog.findFirst({
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

  const allLogs = await prisma.fuelLog.findMany({
    where: { bikeId, isDeleted: false },
    orderBy: { date: "asc" },
  });

  const totalDistanceKm = endOdometer - bike.initialOdometer;
  const totalLitersConsumed = allLogs.reduce((sum, log) => sum + log.litersAdded, 0);
  const fuelLogCount = allLogs.length;

  return { totalDistanceKm, totalLitersConsumed, fuelLogCount };
};

const getMileageTrendFromDB = async (
  bikeId: string,
  months: number,
): Promise<TrendMileageResult> => {
  const now = new Date();
  const monthlySummary: MonthlyMileageResult[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const targetMonth = `${year}-${String(month).padStart(2, "0")}`;
    const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);
    const summary = await computeMileageForRange(bikeId, startDate, endDate);
    monthlySummary.push({ targetMonth, ...summary });
  }
  return { months, monthlySummary };
};

export const mileageRecordServices = {
  computeMileageForRange,
  getMileageRecordsFromDB,
  getMonthlyMileageFromDB,
  getYearlyMileageFromDB,
  getLifetimeMileageFromDB,
  getMileageTrendFromDB,
};
