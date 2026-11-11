import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import catchAsync from "../../util/catchAsync";
import sendResponse from "../../util/sendResponse";
import { spendingServices } from "./spending.service";

const getSpendingSummary = catchAsync(async (req, res) => {
  const period = req.query.period as string | undefined;

  if (!period || !["month", "year", "lifetime"].includes(period)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "period must be one of: month, year, lifetime",
    );
  }

  const targetMonth = req.query.targetMonth as string | undefined;
  const targetYear = req.query.targetYear as string | undefined;

  const result = await spendingServices.getSpendingSummaryFromDB(
    req.params.bikeId,
    req.user.userId,
    period as "month" | "year" | "lifetime",
    targetMonth,
    targetYear,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Spending summary retrieved successfully",
    data: result,
  });
});

const getSpendingTrend = catchAsync(async (req, res) => {
  const targetYearRaw = req.query.targetYear as string | undefined;
  const monthsRaw = req.query.months as string | undefined;

  // ! spec 63: targetYear (a calendar Jan→Dec year) takes precedence over months (the
  // ! rolling window). Only one path runs; the other validation is skipped.
  let options: { months?: number; targetYear?: number };
  if (targetYearRaw) {
    const targetYear = parseInt(targetYearRaw, 10);
    if (isNaN(targetYear) || targetYear < 2000 || targetYear > 2100) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "targetYear must be a year between 2000 and 2100",
      );
    }
    options = { targetYear };
  } else {
    const months = monthsRaw ? parseInt(monthsRaw, 10) : 3;
    if (isNaN(months) || months < 1 || months > 24) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "months must be a number between 1 and 24",
      );
    }
    options = { months };
  }

  const result = await spendingServices.getSpendingTrendFromDB(
    req.params.bikeId,
    req.user.userId,
    options,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Spending trend retrieved successfully",
    data: result,
  });
});

const getSpendingDetails = catchAsync(async (req, res) => {
  const period = req.query.period as string | undefined;

  if (!period || !["month", "year", "lifetime"].includes(period)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "period must be one of: month, year, lifetime",
    );
  }

  const targetMonth = req.query.targetMonth as string | undefined;
  const targetYear = req.query.targetYear as string | undefined;

  const result = await spendingServices.getSpendingDetailsFromDB(
    req.params.bikeId,
    req.user.userId,
    period as "month" | "year" | "lifetime",
    targetMonth,
    targetYear,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Spending details retrieved successfully",
    data: result,
  });
});

// ! Spec 60: month-only category drill-down for the app's Month tab. Unlike
// ! getSpendingSummary there is no `period` param — this endpoint is month-by-definition,
// ! so targetMonth is always required and no year/lifetime branch exists.
const getMonthlyBreakdown = catchAsync(async (req, res) => {
  const targetMonth = req.query.targetMonth as string | undefined;

  if (!targetMonth) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "targetMonth is required. Use YYYY-MM",
    );
  }

  const result = await spendingServices.getMonthlyCategoryBreakdownFromDB(
    req.params.bikeId,
    req.user.userId,
    targetMonth,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Monthly spending breakdown retrieved successfully",
    data: result,
  });
});

// ! Spec 61: category drill-down for the Year and Lifetime tabs. A category expands to
// ! time buckets (per-month for a year, per-year for lifetime). `period` is year|lifetime
// ! only — the Month tab keeps its own /monthly-breakdown route. targetYear is required
// ! for period=year and ignored for lifetime.
const getPeriodBreakdown = catchAsync(async (req, res) => {
  const period = req.query.period as string | undefined;

  if (!period || !["year", "lifetime"].includes(period)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "period must be one of: year, lifetime",
    );
  }

  const targetYear = req.query.targetYear as string | undefined;

  const result = await spendingServices.getPeriodCategoryBreakdownFromDB(
    req.params.bikeId,
    req.user.userId,
    period as "year" | "lifetime",
    targetYear,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Period spending breakdown retrieved successfully",
    data: result,
  });
});

export const spendingController = {
  getSpendingSummary,
  getSpendingTrend,
  getSpendingDetails,
  getMonthlyBreakdown,
  getPeriodBreakdown,
};
