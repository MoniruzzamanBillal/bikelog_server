import httpStatus from "http-status";
import catchAsync from "../../util/catchAsync";
import sendResponse from "../../util/sendResponse";
import { maintenanceLogServices } from "./maintenanceLog.service";

const createMaintenanceLog = catchAsync(async (req, res) => {
  const result = await maintenanceLogServices.createMaintenanceLogIntoDB(
    req.params.bikeId,
    req.user.userId,
    req.body,
  );

  sendResponse(res, {
    status: httpStatus.CREATED,
    success: true,
    message: "Maintenance log created successfully",
    data: result,
  });
});

const getMaintenanceLogs = catchAsync(async (req, res) => {
  const { result, meta } = await maintenanceLogServices.getMaintenanceLogsFromDB(
    req.params.bikeId,
    req.user.userId,
    req.query,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Maintenance logs retrieved successfully",
    data: { result, meta },
  });
});

const getMaintenanceLogById = catchAsync(async (req, res) => {
  const result = await maintenanceLogServices.getMaintenanceLogByIdFromDB(
    req.params.bikeId,
    req.user.userId,
    req.params.id,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Maintenance log retrieved successfully",
    data: result,
  });
});

const updateMaintenanceLog = catchAsync(async (req, res) => {
  const result = await maintenanceLogServices.updateMaintenanceLogInDB(
    req.params.bikeId,
    req.user.userId,
    req.params.id,
    req.body,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Maintenance log updated successfully",
    data: result,
  });
});

const deleteMaintenanceLog = catchAsync(async (req, res) => {
  const result = await maintenanceLogServices.deleteMaintenanceLogFromDB(
    req.params.bikeId,
    req.user.userId,
    req.params.id,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Maintenance log deleted successfully",
    data: result,
  });
});

const getReminders = catchAsync(async (req, res) => {
  const result = await maintenanceLogServices.getRemindersFromDB(
    req.params.bikeId,
    req.user.userId,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Reminders retrieved successfully",
    data: result,
  });
});

export const maintenanceLogController = {
  createMaintenanceLog,
  getMaintenanceLogs,
  getMaintenanceLogById,
  updateMaintenanceLog,
  deleteMaintenanceLog,
  getReminders,
};
