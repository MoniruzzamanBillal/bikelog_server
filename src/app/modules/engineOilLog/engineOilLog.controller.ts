import httpStatus from "http-status";
import catchAsync from "../../util/catchAsync";
import sendResponse from "../../util/sendResponse";
import { notifyExpenseTracker } from "../../util/expenseTrackerClient";
import { buildEngineOilLogSummary } from "../../util/transactionRequestSummary";
import { engineOilLogServices } from "./engineOilLog.service";

const createEngineOilLog = catchAsync(async (req, res) => {
  const { log, oilTypeName, bikeNickname } =
    await engineOilLogServices.createEngineOilLogIntoDB(
      req.params.bikeId,
      req.user.userId,
      req.body,
    );

  const { title, description } = buildEngineOilLogSummary(
    log,
    oilTypeName,
    bikeNickname,
  );

  // ! D8: reuses `sourceType: "maintenance"` on purpose — that union is validated on
  // ! expenseTracker2's side and that project is explicitly out of this cascade. Ids never
  // ! collide, so dedupe over there is unaffected. A real "oil" source there is a later note.
  notifyExpenseTracker({
    sourceType: "maintenance",
    sourceRecordId: String(log._id),
    userEmail: req.user.userEmail,
    userId: req.user.userId,
    title,
    description,
    amount: log.cost,
    occurredAt: log.changeDate,
  });

  sendResponse(res, {
    status: httpStatus.CREATED,
    success: true,
    message: "Engine oil log created successfully",
    data: log,
  });
});

const getEngineOilLogs = catchAsync(async (req, res) => {
  const { result, meta } = await engineOilLogServices.getEngineOilLogsFromDB(
    req.params.bikeId,
    req.user.userId,
    req.query,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Engine oil logs retrieved successfully",
    data: { result, meta },
  });
});

const getEngineOilLogById = catchAsync(async (req, res) => {
  const result = await engineOilLogServices.getEngineOilLogByIdFromDB(
    req.params.bikeId,
    req.user.userId,
    req.params.id,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Engine oil log retrieved successfully",
    data: result,
  });
});

const updateEngineOilLog = catchAsync(async (req, res) => {
  const result = await engineOilLogServices.updateEngineOilLogInDB(
    req.params.bikeId,
    req.user.userId,
    req.params.id,
    req.body,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Engine oil log updated successfully",
    data: result,
  });
});

const deleteEngineOilLog = catchAsync(async (req, res) => {
  const result = await engineOilLogServices.deleteEngineOilLogFromDB(
    req.params.bikeId,
    req.user.userId,
    req.params.id,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Engine oil log deleted successfully",
    data: result,
  });
});

const getEngineOilStatus = catchAsync(async (req, res) => {
  const result = await engineOilLogServices.getEngineOilStatusFromDB(
    req.params.bikeId,
    req.user.userId,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Engine oil status retrieved successfully",
    data: result,
  });
});

const uploadEngineOilLogImage = catchAsync(async (req, res) => {
  const result = await engineOilLogServices.uploadEngineOilLogImageIntoDB(
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

const deleteEngineOilLogImage = catchAsync(async (req, res) => {
  const result = await engineOilLogServices.deleteEngineOilLogImageFromDB(
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

export const engineOilLogController = {
  createEngineOilLog,
  getEngineOilLogs,
  getEngineOilLogById,
  updateEngineOilLog,
  deleteEngineOilLog,
  getEngineOilStatus,
  uploadEngineOilLogImage,
  deleteEngineOilLogImage,
};
