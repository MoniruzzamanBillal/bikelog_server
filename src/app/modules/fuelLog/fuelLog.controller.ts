import httpStatus from "http-status";
import catchAsync from "../../util/catchAsync";
import sendResponse from "../../util/sendResponse";
import { fuelLogServices } from "./fuelLog.service";

const createFuelLog = catchAsync(async (req, res) => {
  const { fuelLog, mileageRecordClosed } = await fuelLogServices.createFuelLogIntoDB(
    req.params.bikeId,
    req.user.userId,
    req.body,
  );

  sendResponse(res, {
    status: httpStatus.CREATED,
    success: true,
    message: "Fuel log created successfully",
    data: { fuelLog, mileageRecordClosed },
  });
});

const getFuelLogs = catchAsync(async (req, res) => {
  const { result, meta } = await fuelLogServices.getFuelLogsFromDB(
    req.params.bikeId,
    req.user.userId,
    req.query,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Fuel logs retrieved successfully",
    data: { result, meta },
  });
});

const getFuelLogById = catchAsync(async (req, res) => {
  const result = await fuelLogServices.getFuelLogByIdFromDB(
    req.params.bikeId,
    req.user.userId,
    req.params.id,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Fuel log retrieved successfully",
    data: result,
  });
});

const updateFuelLog = catchAsync(async (req, res) => {
  const result = await fuelLogServices.updateFuelLogInDB(
    req.params.bikeId,
    req.user.userId,
    req.params.id,
    req.body,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Fuel log updated successfully",
    data: result,
  });
});

const deleteFuelLog = catchAsync(async (req, res) => {
  const result = await fuelLogServices.deleteFuelLogFromDB(
    req.params.bikeId,
    req.user.userId,
    req.params.id,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Fuel log deleted successfully",
    data: result,
  });
});

export const fuelLogController = {
  createFuelLog,
  getFuelLogs,
  getFuelLogById,
  updateFuelLog,
  deleteFuelLog,
};