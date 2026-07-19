import httpStatus from "http-status";
import catchAsync from "../../util/catchAsync";
import sendResponse from "../../util/sendResponse";
import { maintenanceTypeServices } from "./maintenanceType.service";

const createMaintenanceType = catchAsync(async (req, res) => {
  const result = await maintenanceTypeServices.createMaintenanceTypeIntoDB(req.body);
  sendResponse(res, {
    status: httpStatus.CREATED,
    success: true,
    message: "Maintenance type created successfully",
    data: result,
  });
});

const getMaintenanceTypes = catchAsync(async (req, res) => {
  const result = await maintenanceTypeServices.getMaintenanceTypesFromDB();
  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Maintenance types retrieved successfully",
    data: result,
  });
});

export const maintenanceTypeController = {
  createMaintenanceType,
  getMaintenanceTypes,
};