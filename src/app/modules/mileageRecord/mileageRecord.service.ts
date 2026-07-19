import { fuelLogModel } from "../fuelLog/fuelLog.model";
import { mileageRecordModel } from "./mileageRecord.model";
import { bikeModel } from "../bike/bike.model";
import httpStatus from "http-status";
import AppError from "../../Error/AppError";

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

const computeMileageForRange = async (
  bikeId: string,
  startDate: Date,
  endDate: Date,
): Promise<MileageSummary> => {
  const fuelLogsInRange = await fuelLogModel
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

  const previousLog = await fuelLogModel
    .findOne({
      bike: bikeId,
      date: { $lt: startDate },
      isDeleted: false,
    })
    .sort({ date: -1 })
    .lean();

  let startOdometer: number;
  if (previousLog) {
    startOdometer = previousLog.odometerReading;
  } else {
    // ! no earlier fuel log — anchor on the bike's immutable initialOdometer, not
    // ! currentOdometer (which reflects TODAY's reading, not the reading as of this
    // ! historical range's start, once any later fuel/maintenance log has bumped it)
    const bike = await bikeModel.findById(bikeId).lean();
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

const getMileageRecordsFromDB = async (bikeId: string) => {
  const exactRecords = await mileageRecordModel
    .find({ bike: bikeId })
    .sort({ periodEndDate: -1 })
    .lean();

  const recentFuelLogs = await fuelLogModel
    .find({ bike: bikeId, isDeleted: false })
    .sort({ date: -1 })
    .limit(ROLLING_AVERAGE_WINDOW)
    .lean();

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

  return { exactRecords, approximate };
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
  const bike = await bikeModel.findById(bikeId).lean();
  if (!bike) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike not found");
  }

  const latestFuelLog = await fuelLogModel
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

  const allLogs = await fuelLogModel
    .find({ bike: bikeId, isDeleted: false })
    .sort({ date: 1 })
    .lean();

  const totalDistanceKm = endOdometer - bike.initialOdometer;
  const totalLitersConsumed = allLogs.reduce((sum, log) => sum + log.litersAdded, 0);
  const fuelLogCount = allLogs.length;

  return { totalDistanceKm, totalLitersConsumed, fuelLogCount };
};

export const mileageRecordServices = {
  getMileageRecordsFromDB,
  getMonthlyMileageFromDB,
  getYearlyMileageFromDB,
  getLifetimeMileageFromDB,
};