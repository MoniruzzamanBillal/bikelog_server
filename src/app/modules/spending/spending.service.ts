import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import { findOwnedBikeOrThrow } from "../bike/bike.utils";
import { fuelLogModel } from "../fuelLog/fuelLog.model";
import { maintenanceLogModel } from "../maintenanceLog/maintenanceLog.model";
import { TSpendingRecord } from "./spending.interface";

// ! shared by getSpendingSummaryFromDB and getSpendingDetailsFromDB so the two endpoints'
// ! date-range math can never drift apart from each other
const resolveSpendingDateRange = (
  period: "month" | "year" | "lifetime",
  targetMonth?: string,
  targetYear?: string,
): { startDate?: Date; endDate?: Date } => {
  if (period === "month") {
    if (!targetMonth) {
      throw new AppError(httpStatus.BAD_REQUEST, "targetMonth is required for period=month");
    }

    const [yearStr, monthStr] = targetMonth.split("-");
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    if (isNaN(year) || isNaN(month) || month < 1 || month > 12 || year < 2000 || year > 2100) {
      throw new AppError(httpStatus.BAD_REQUEST, "Invalid targetMonth format. Use YYYY-MM");
    }

    return {
      startDate: new Date(year, month - 1, 1, 0, 0, 0, 0),
      endDate: new Date(year, month, 0, 23, 59, 59, 999),
    };
  }

  if (period === "year") {
    if (!targetYear) {
      throw new AppError(httpStatus.BAD_REQUEST, "targetYear is required for period=year");
    }

    const year = parseInt(targetYear, 10);

    if (isNaN(year) || year < 2000 || year > 2100) {
      throw new AppError(httpStatus.BAD_REQUEST, "Invalid targetYear format. Use YYYY");
    }

    return {
      startDate: new Date(year, 0, 1, 0, 0, 0, 0),
      endDate: new Date(year, 11, 31, 23, 59, 59, 999),
    };
  }

  return {};
};

const computeSpendingForRange = async (
  bikeId: string,
  startDate?: Date,
  endDate?: Date,
): Promise<{
  totalSpending: number;
  categoryBreakdown: { category: string; total: number }[];
  records: TSpendingRecord[];
}> => {
  const fuelLogsPromise = fuelLogModel
    .find({
      bike: bikeId,
      isDeleted: false,
      ...(startDate && endDate ? { date: { $gte: startDate, $lte: endDate } } : {}),
    })
    .lean();

  const maintenanceLogsPromise = maintenanceLogModel
    .find({
      bike: bikeId,
      isDeleted: false,
      ...(startDate && endDate ? { serviceDate: { $gte: startDate, $lte: endDate } } : {}),
    })
    .populate("maintenanceType", "name")
    .lean();

  const [fuelLogs, maintenanceLogs] = await Promise.all([
    fuelLogsPromise,
    maintenanceLogsPromise,
  ]);

  const fuelTotal = fuelLogs.reduce((sum, log) => sum + log.totalCost, 0);

  const maintenanceByCategory = maintenanceLogs.reduce<Record<string, number>>(
    (acc, log) => {
      const mt = log.maintenanceType as unknown as { _id: string; name: string } | null;
      const category = mt?.name ?? "Unknown";
      acc[category] = (acc[category] ?? 0) + log.cost;
      return acc;
    },
    {},
  );

  const categoryBreakdown: { category: string; total: number }[] = [
    { category: "Fuel", total: fuelTotal },
    ...Object.entries(maintenanceByCategory).map(([category, total]) => ({
      category,
      total,
    })),
  ];

  categoryBreakdown.sort((a, b) => b.total - a.total);

  const maintenanceTotal = maintenanceLogs.reduce((sum, log) => sum + log.cost, 0);
  const totalSpending = fuelTotal + maintenanceTotal;

  const fuelRecords: TSpendingRecord[] = fuelLogs.map((log) => ({
    date: log.date,
    category: "Fuel",
    description: `${log.litersAdded}L${log.isFullTank ? " (Full Tank)" : ""} @ ৳${log.pricePerLiter}/L`,
    amount: log.totalCost,
    vendor: log.fuelStation ?? null,
    remarks: log.notes ?? null,
    source: "fuel",
  }));

  const maintenanceRecords: TSpendingRecord[] = maintenanceLogs.map((log) => {
    const mt = log.maintenanceType as unknown as { _id: string; name: string } | null;
    const category = mt?.name ?? "Unknown";
    return {
      date: log.serviceDate,
      category,
      description: log.partsReplaced?.length ? log.partsReplaced.join(", ") : category,
      amount: log.cost,
      vendor: log.serviceCenter ?? null,
      remarks: log.notes ?? null,
      source: "maintenance",
    };
  });

  const records = [...fuelRecords, ...maintenanceRecords].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  return { totalSpending, categoryBreakdown, records };
};

const getSpendingSummaryFromDB = async (
  bikeId: string,
  userId: string,
  period: "month" | "year" | "lifetime",
  targetMonth?: string,
  targetYear?: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const { startDate, endDate } = resolveSpendingDateRange(period, targetMonth, targetYear);

  const { totalSpending, categoryBreakdown } = await computeSpendingForRange(
    bikeId,
    startDate,
    endDate,
  );

  return {
    period,
    ...(targetMonth ? { targetMonth } : {}),
    ...(targetYear ? { targetYear } : {}),
    totalSpending,
    categoryBreakdown,
  };
};

const getSpendingDetailsFromDB = async (
  bikeId: string,
  userId: string,
  period: "month" | "year" | "lifetime",
  targetMonth?: string,
  targetYear?: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const { startDate, endDate } = resolveSpendingDateRange(period, targetMonth, targetYear);

  const { totalSpending, categoryBreakdown, records } = await computeSpendingForRange(
    bikeId,
    startDate,
    endDate,
  );

  return {
    period,
    ...(targetMonth ? { targetMonth } : {}),
    ...(targetYear ? { targetYear } : {}),
    totalSpending,
    categoryBreakdown,
    records,
  };
};

const getSpendingTrendFromDB = async (
  bikeId: string,
  userId: string,
  months: number,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);
  const now = new Date();
  const monthlySummary = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const targetMonth = `${year}-${String(month).padStart(2, "0")}`;
    const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);
    const { totalSpending, categoryBreakdown } = await computeSpendingForRange(
      bikeId,
      startDate,
      endDate,
    );
    monthlySummary.push({ targetMonth, totalSpending, categoryBreakdown });
  }
  return { months, monthlySummary };
};

export const spendingServices = {
  computeSpendingForRange,
  getSpendingSummaryFromDB,
  getSpendingTrendFromDB,
  getSpendingDetailsFromDB,
};
