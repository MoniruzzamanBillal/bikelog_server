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
  const monthsRaw = req.query.months as string | undefined;
  const months = monthsRaw ? parseInt(monthsRaw, 10) : 3;

  if (isNaN(months) || months < 1 || months > 24) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "months must be a number between 1 and 24",
    );
  }

  const result = await spendingServices.getSpendingTrendFromDB(
    req.params.bikeId,
    req.user.userId,
    months,
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

export const spendingController = {
  getSpendingSummary,
  getSpendingTrend,
  getSpendingDetails,
};
