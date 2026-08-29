import httpStatus from "http-status";
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

export const errorLogController = {
  getErrorLogs,
  getErrorLogById,
};
