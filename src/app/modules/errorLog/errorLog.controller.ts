import httpStatus from "http-status";
import config from "../../config";
import AppError from "../../Error/AppError";
import catchAsync from "../../util/catchAsync";
import sendResponse from "../../util/sendResponse";
import { errorLogServices } from "./errorLog.service";

const getErrorLogs = catchAsync(async (req, res) => {
  const { result, meta } = await errorLogServices.getErrorLogsFromDB(
    req.query,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Error logs retrieved successfully",
    data: { result, meta },
  });
});

const getErrorLogById = catchAsync(async (req, res) => {
  const result = await errorLogServices.getErrorLogByIdFromDB(
    req.params.id,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Error log retrieved successfully",
    data: result,
  });
});

// ! machine-to-machine endpoint hit by a scheduled job, not a logged-in admin — protected by
// ! a shared secret header instead of authCheck/adminCheck (see
// ! .github/workflows/daily-error-log-cleanup.yml and notification.controller.ts's identical pattern)
const cleanupExpiredErrorLogs = catchAsync(async (req, res) => {
  const secret = req.headers["x-cron-secret"];

  if (typeof secret !== "string" || secret !== config.cronSecret) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Invalid or missing cron secret");
  }

  const result = await errorLogServices.cleanupExpiredErrorLogsFromDB();

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Expired error logs cleaned up",
    data: result,
  });
});

export const errorLogController = {
  getErrorLogs,
  getErrorLogById,
  cleanupExpiredErrorLogs,
};
