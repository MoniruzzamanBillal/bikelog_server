import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import catchAsync from "../../util/catchAsync";

// ! for getting the spending summary (total + category breakdown) for a bike
const getSpendingSummary = catchAsync(async () => {
  throw new AppError(httpStatus.NOT_IMPLEMENTED, "Not implemented yet");
});

//
export const spendingController = {
  getSpendingSummary,
};
