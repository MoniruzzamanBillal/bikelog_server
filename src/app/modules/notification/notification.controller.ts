import httpStatus from "http-status";
import config from "../../config";
import AppError from "../../Error/AppError";
import catchAsync from "../../util/catchAsync";
import sendResponse from "../../util/sendResponse";
import { notificationServices } from "./notification.service";

// ! machine-to-machine endpoint hit by a scheduled job, not a logged-in user — protected by
// ! a shared secret header instead of authCheck/JWT (see .github/workflows/weekly-summary-cron.yml)
const triggerWeeklySummary = catchAsync(async (req, res) => {
  const secret = req.headers["x-cron-secret"];

  if (typeof secret !== "string" || secret !== config.cronSecret) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Invalid or missing cron secret");
  }

  const result = await notificationServices.sendWeeklySummaries();

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Weekly summary notifications processed",
    data: result,
  });
});

//
export const notificationController = {
  triggerWeeklySummary,
};
