import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import catchAsync from "../../util/catchAsync";

// ! for creating a maintenance log
const createMaintenanceLog = catchAsync(async () => {
  throw new AppError(httpStatus.NOT_IMPLEMENTED, "Not implemented yet");
});

// ! for getting all maintenance logs for a bike
const getMaintenanceLogs = catchAsync(async () => {
  throw new AppError(httpStatus.NOT_IMPLEMENTED, "Not implemented yet");
});

// ! for getting a single maintenance log by id
const getMaintenanceLogById = catchAsync(async () => {
  throw new AppError(httpStatus.NOT_IMPLEMENTED, "Not implemented yet");
});

// ! for updating a maintenance log
const updateMaintenanceLog = catchAsync(async () => {
  throw new AppError(httpStatus.NOT_IMPLEMENTED, "Not implemented yet");
});

// ! for deleting a maintenance log
const deleteMaintenanceLog = catchAsync(async () => {
  throw new AppError(httpStatus.NOT_IMPLEMENTED, "Not implemented yet");
});

// ! for getting due/overdue/upcoming maintenance reminders for a bike
const getReminders = catchAsync(async () => {
  throw new AppError(httpStatus.NOT_IMPLEMENTED, "Not implemented yet");
});

//
export const maintenanceLogController = {
  createMaintenanceLog,
  getMaintenanceLogs,
  getMaintenanceLogById,
  updateMaintenanceLog,
  deleteMaintenanceLog,
  getReminders,
};
