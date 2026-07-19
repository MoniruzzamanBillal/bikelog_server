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

export const spendingController = {
  getSpendingSummary,
};
