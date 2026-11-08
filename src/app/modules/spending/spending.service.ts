import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import { prisma } from "../../lib/prisma";
import { findOwnedBikeOrThrow } from "../bike/bike.utils";
import { AccessoryStatus } from "../bikeAccessory/bikeAccessory.constant";
import {
  TSpendingCategoryGroup,
  TSpendingPeriodGroup,
  TSpendingRecord,
} from "./spending.interface";

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
  const [fuelLogs, maintenanceLogs, accessories, engineOilLogs] = await Promise.all([
    prisma.fuelLog.findMany({
      where: {
        bikeId,
        isDeleted: false,
        ...(startDate && endDate ? { date: { gte: startDate, lte: endDate } } : {}),
      },
    }),
    prisma.maintenanceLog.findMany({
      where: {
        bikeId,
        isDeleted: false,
        ...(startDate && endDate ? { serviceDate: { gte: startDate, lte: endDate } } : {}),
      },
      // ! replaces Mongoose's .populate("maintenanceType", "name")
      include: { maintenanceType: { select: { name: true } } },
    }),
    // ! only purchased accessories count as real spending — pending/cancelled wishlist
    // ! entries are never included
    prisma.bikeAccessory.findMany({
      where: {
        bikeId,
        isDeleted: false,
        status: AccessoryStatus.purchased,
        ...(startDate && endDate ? { purchaseDate: { gte: startDate, lte: endDate } } : {}),
      },
    }),
    // ! Spec 54 §F/D7: an oil change is its own record now, and the money is real — without
    // ! this the bike hub's totals would drop by the cost of every oil change ever logged
    // ! the moment the import soft-deletes the source maintenance logs.
    // ! §0 H3: between the import's --apply and its --finalize, oil is counted TWICE here
    // ! (once from the still-live maintenance log, once from the copy). That window is
    // ! read-only and minutes long inside one operator session — run copy, verify, finalize
    // ! in one sitting, and before the web client ships.
    prisma.engineOilLog.findMany({
      where: {
        bikeId,
        isDeleted: false,
        ...(startDate && endDate ? { changeDate: { gte: startDate, lte: endDate } } : {}),
      },
      include: { oilType: { select: { name: true } } },
    }),
  ]);

  // ! every Decimal(12,2) field read here MUST go through Number(...) before arithmetic —
  // ! a Prisma Decimal instance doesn't do real arithmetic through JS's +/* operators
  const fuelTotal = fuelLogs.reduce((sum, log) => sum + Number(log.totalCost), 0);

  const maintenanceByCategory = maintenanceLogs.reduce<Record<string, number>>(
    (acc, log) => {
      // ! maintenanceType is a required FK, so null shouldn't actually occur — the "Unknown"
      // ! fallback is defensive, matching pre-migration behavior rather than tightening it
      const category = log.maintenanceType?.name ?? "Unknown";
      acc[category] = (acc[category] ?? 0) + Number(log.cost);
      return acc;
    },
    {},
  );

  const accessoryTotal = accessories.reduce(
    (sum, a) => sum + (a.price ? Number(a.price) : 0),
    0,
  );

  const oilTotal = engineOilLogs.reduce((sum, log) => sum + Number(log.cost), 0);

  const categoryBreakdown: { category: string; total: number }[] = [
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

  const maintenanceTotal = maintenanceLogs.reduce(
    (sum, log) => sum + Number(log.cost),
    0,
  );
  // ! easy to miss, because the category array above is built separately from this sum
  const totalSpending =
    fuelTotal + maintenanceTotal + accessoryTotal + oilTotal;

  const fuelRecords: TSpendingRecord[] = fuelLogs.map((log) => ({
    date: log.date,
    category: "Fuel",
    description: `${log.litersAdded}L${log.isFullTank ? " (Full Tank)" : ""} @ ৳${Number(log.pricePerLiter)}/L`,
    amount: Number(log.totalCost),
    vendor: log.fuelStation ?? null,
    remarks: log.notes ?? null,
    source: "fuel",
    liters: Number(log.litersAdded),
  }));

  const maintenanceRecords: TSpendingRecord[] = maintenanceLogs.map((log) => {
    const category = log.maintenanceType?.name ?? "Unknown";
    return {
      date: log.serviceDate,
      category,
      description: log.partsReplaced?.length ? log.partsReplaced.join(", ") : category,
      amount: Number(log.cost),
      vendor: log.serviceCenter ?? null,
      remarks: log.notes ?? null,
      source: "maintenance",
      liters: null,
    };
  });

  const accessoryRecords: TSpendingRecord[] = accessories.map((a) => ({
    date: a.purchaseDate as Date,
    category: "Accessories",
    description: a.name,
    amount: a.price !== null ? Number(a.price) : 0,
    vendor: null,
    remarks: null,
    source: "accessory",
    liters: null,
  }));

  const engineOilRecords: TSpendingRecord[] = engineOilLogs.map((log) => ({
    date: log.changeDate,
    category: "Engine Oil",
    description:
      (log.oilType?.name ?? "Engine oil") +
      (log.oilFilterChanged ? " · filter changed" : ""),
    amount: Number(log.cost),
    vendor: log.serviceCenter ?? null,
    remarks: log.notes ?? null,
    source: "oil",
    liters: null,
  }));

  const records = [
    ...fuelRecords,
    ...maintenanceRecords,
    ...accessoryRecords,
    ...engineOilRecords,
  ].sort(
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

// ! Spec 60: month-only category drill-down for the app's Month tab accordions.
// ! Reuses computeSpendingForRange (so the date math and per-record shape can never
// ! drift from the summary/details endpoints) and simply groups its flat records[] by
// ! category. The categories are derived from the records themselves rather than from
// ! categoryBreakdown: computeSpendingForRange always emits a `Fuel` breakdown row even
// ! at ৳0, and a zero-value bucket here would render as an accordion that expands to
// ! nothing. Grouping from records drops any category with no line items, and the per-
// ! category totals still sum to totalSpending because every cost lives in exactly one
// ! record.
const getMonthlyCategoryBreakdownFromDB = async (
  bikeId: string,
  userId: string,
  targetMonth: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const { startDate, endDate } = resolveSpendingDateRange("month", targetMonth);

  const { totalSpending, records } = await computeSpendingForRange(
    bikeId,
    startDate,
    endDate,
  );

  const groups = new Map<string, TSpendingCategoryGroup>();
  for (const record of records) {
    const existing = groups.get(record.category);
    if (existing) {
      existing.total += record.amount;
      existing.records.push(record);
    } else {
      groups.set(record.category, {
        category: record.category,
        total: record.amount,
        records: [record],
      });
    }
  }

  const categories = [...groups.values()]
    .map((group) => ({
      ...group,
      // ! newest-first inside a category: computeSpendingForRange sorts records
      // ! oldest-first (right for the PDF's chronological read, backwards for a
      // ! drill-down where the most recent spend is what the rider wants first)
      records: [...group.records].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      ),
    }))
    .sort((a, b) => b.total - a.total);

  return {
    period: "month" as const,
    targetMonth,
    totalSpending,
    categories,
  };
};

// ! Spec 61: category drill-down for the Year and Lifetime tabs. Same shape idea as spec
// ! 60's month breakdown, but a category expands to TIME BUCKETS, not individual records:
// ! per-month for a year, per-year for lifetime. Reuses computeSpendingForRange (so the
// ! date math and totals can never drift from the summary/details endpoints) and buckets
// ! its flat records[]. Fuel buckets carry summed litres; every other category's litres is
// ! null. Categories are derived from the records themselves — a ৳0 Fuel row never appears,
// ! matching spec 60's reasoning — and per-category totals still sum to totalSpending
// ! because every cost lives in exactly one record.
const getPeriodCategoryBreakdownFromDB = async (
  bikeId: string,
  userId: string,
  period: "year" | "lifetime",
  targetYear?: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const { startDate, endDate } =
    period === "year"
      ? resolveSpendingDateRange("year", undefined, targetYear)
      : resolveSpendingDateRange("lifetime");

  const { totalSpending, records } = await computeSpendingForRange(
    bikeId,
    startDate,
    endDate,
  );

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

  type BucketAcc = { key: string; label: string; total: number; liters: number | null };
  type GroupAcc = { category: string; total: number; buckets: Map<string, BucketAcc> };

  const groups = new Map<string, GroupAcc>();

  for (const record of records) {
    const date = new Date(record?.date);
    const year = date.getFullYear();
    const month = date.getMonth(); // 0-11

    const bucketKey =
      period === "year"
        ? `${year}-${String(month + 1).padStart(2, "0")}`
        : `${year}`;
    const bucketLabel = period === "year" ? monthLabels[month] : `${year}`;

    let group = groups.get(record?.category);
    if (!group) {
      group = { category: record?.category, total: 0, buckets: new Map() };
      groups.set(record?.category, group);
    }
    group.total += record?.amount ?? 0;

    let bucket = group.buckets.get(bucketKey);
    if (!bucket) {
      bucket = { key: bucketKey, label: bucketLabel, total: 0, liters: null };
      group.buckets.set(bucketKey, bucket);
    }
    bucket.total += record?.amount ?? 0;
    if (record?.liters != null) {
      bucket.liters = (bucket?.liters ?? 0) + record?.liters;
    }
  }

  const categories: TSpendingPeriodGroup[] = [...groups.values()]
    .map((group) => {
      const buckets = [...group.buckets.values()].sort((a, b) =>
        // ! year view: months chronological (Jan→Dec). lifetime: years newest-first.
        period === "year"
          ? a?.key.localeCompare(b?.key)
          : b?.key.localeCompare(a?.key),
      );
      const totalLiters = buckets.reduce<number | null>(
        (sum, b) => (b?.liters != null ? (sum ?? 0) + b?.liters : sum),
        null,
      );
      return {
        category: group?.category,
        total: group?.total,
        totalLiters,
        buckets,
      };
    })
    .sort((a, b) => b?.total - a?.total);

  return {
    period,
    ...(targetYear ? { targetYear } : {}),
    totalSpending,
    categories,
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
  getMonthlyCategoryBreakdownFromDB,
  getPeriodCategoryBreakdownFromDB,
};
