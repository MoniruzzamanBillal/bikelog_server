import httpStatus from "http-status";
import catchAsync from "../../util/catchAsync";
import sendResponse from "../../util/sendResponse";
import { notifyExpenseTracker } from "../../util/expenseTrackerClient";
import { buildServiceLogSummary } from "../../util/transactionRequestSummary";
import { serviceLogServices } from "./serviceLog.service";

// ! One place for the expense push, used by both create and update. Fires only when a
// ! service first becomes completed AND carries a cost — a free or still-scheduled service
// ! pushes nothing. `sourceType: "maintenance"` is reused on purpose (that union is validated
// ! on expenseTracker2's side, which is out of this cascade); dedupe there keys on
// ! sourceRecordId (the service id), so an edit never doubles the pending item.
const maybeNotifyExpenseTracker = (
  result: Awaited<ReturnType<typeof serviceLogServices.createServiceLogIntoDB>>,
  userEmail: string,
  userId: string,
) => {
  if (!result.justCompleted || result.itemTotal <= 0) return;

  const { title, description } = buildServiceLogSummary(
    result.log,
    result.bikeNickname,
  );

  notifyExpenseTracker({
    sourceType: "maintenance",
    sourceRecordId: String(result.log._id),
    userEmail,
    userId,
    title,
    description,
    amount: result.itemTotal,
    occurredAt: result.log.serviceDate ?? new Date(),
  });
};

const createServiceLog = catchAsync(async (req, res) => {
  const result = await serviceLogServices.createServiceLogIntoDB(
    req.params.bikeId,
    req.user.userId,
    req.body,
  );

  maybeNotifyExpenseTracker(result, req.user.userEmail, req.user.userId);

  sendResponse(res, {
    status: httpStatus.CREATED,
    success: true,
    message: "Service log created successfully",
    data: result.log,
  });
});

const getServiceLogs = catchAsync(async (req, res) => {
  const { result, meta } = await serviceLogServices.getServiceLogsFromDB(
    req.params.bikeId,
    req.user.userId,
    req.query,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Service logs retrieved successfully",
    data: { result, meta },
  });
});

const getServiceStatus = catchAsync(async (req, res) => {
  const result = await serviceLogServices.getServiceStatusFromDB(
    req.params.bikeId,
    req.user.userId,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Service status retrieved successfully",
    data: result,
  });
});

const getServiceLogById = catchAsync(async (req, res) => {
  const result = await serviceLogServices.getServiceLogByIdFromDB(
    req.params.bikeId,
    req.user.userId,
    req.params.id,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Service log retrieved successfully",
    data: result,
  });
});

const updateServiceLog = catchAsync(async (req, res) => {
  const result = await serviceLogServices.updateServiceLogInDB(
    req.params.bikeId,
    req.user.userId,
    req.params.id,
    req.body,
  );

  maybeNotifyExpenseTracker(result, req.user.userEmail, req.user.userId);

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Service log updated successfully",
    data: result.log,
  });
});

const deleteServiceLog = catchAsync(async (req, res) => {
  const result = await serviceLogServices.deleteServiceLogFromDB(
    req.params.bikeId,
    req.user.userId,
    req.params.id,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Service log deleted successfully",
    data: result,
  });
});

const uploadServiceLogImage = catchAsync(async (req, res) => {
  const result = await serviceLogServices.uploadServiceLogImageIntoDB(
    req.params.bikeId,
    req.user.userId,
    req.params.id,
    req.file,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Receipt image uploaded successfully",
    data: result,
  });
});

const deleteServiceLogImage = catchAsync(async (req, res) => {
  const result = await serviceLogServices.deleteServiceLogImageFromDB(
    req.params.bikeId,
    req.user.userId,
    req.params.id,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Receipt image deleted successfully",
    data: result,
  });
});

export const serviceLogController = {
  createServiceLog,
  getServiceLogs,
  getServiceStatus,
  getServiceLogById,
  updateServiceLog,
  deleteServiceLog,
  uploadServiceLogImage,
  deleteServiceLogImage,
};
