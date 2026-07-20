import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import { findOwnedBikeOrThrow } from "../bike/bike.utils";
import { fuelLogModel } from "../fuelLog/fuelLog.model";
import { maintenanceLogModel } from "../maintenanceLog/maintenanceLog.model";

const getSpendingSummaryFromDB = async (
  bikeId: string,
  userId: string,
  period: "month" | "year" | "lifetime",
  targetMonth?: string,
  targetYear?: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  let startDate: Date | undefined;
  let endDate: Date | undefined;

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

    startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
    endDate = new Date(year, month, 0, 23, 59, 59, 999);
  } else if (period === "year") {
    if (!targetYear) {
      throw new AppError(httpStatus.BAD_REQUEST, "targetYear is required for period=year");
    }

    const year = parseInt(targetYear, 10);

    if (isNaN(year) || year < 2000 || year > 2100) {
      throw new AppError(httpStatus.BAD_REQUEST, "Invalid targetYear format. Use YYYY");
    }

    startDate = new Date(year, 0, 1, 0, 0, 0, 0);
    endDate = new Date(year, 11, 31, 23, 59, 59, 999);
  }

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

  return {
    period,
    ...(targetMonth ? { targetMonth } : {}),
    ...(targetYear ? { targetYear } : {}),
    totalSpending,
    categoryBreakdown,
  };
};

export const spendingServices = {
  getSpendingSummaryFromDB,
};
