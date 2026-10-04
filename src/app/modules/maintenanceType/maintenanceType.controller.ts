import httpStatus from "http-status";
import catchAsync from "../../util/catchAsync";
import sendResponse from "../../util/sendResponse";
import { maintenanceTypeServices } from "./maintenanceType.service";

// ! Spec 46 §D: these four handlers used to never read `req.user` at all, which is how the
// ! catalog ended up global. `req.user.userId` is now the first argument to every service
// ! call. `authCheck` guarantees `req.user` is populated on all four routes.

const createMaintenanceType = catchAsync(async (req, res) => {
  const result = await maintenanceTypeServices.createMaintenanceTypeIntoDB(
    req.user.userId,
    req.body,
  );
  sendResponse(res, {
    status: httpStatus.CREATED,
    success: true,
    message: "Maintenance type created successfully",
    data: result,
  });
});

const getMaintenanceTypes = catchAsync(async (req, res) => {
  const result = await maintenanceTypeServices.getMaintenanceTypesFromDB(
    req.user.userId,
  );
  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Maintenance types retrieved successfully",
    data: result,
  });
});

const updateMaintenanceType = catchAsync(async (req, res) => {
  const result = await maintenanceTypeServices.updateMaintenanceTypeInDB(
    req.user.userId,
    req.params.id,
    req.body,
  );
  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Maintenance type updated successfully",
    data: result,
  });
});

const deleteMaintenanceType = catchAsync(async (req, res) => {
  const result = await maintenanceTypeServices.deleteMaintenanceTypeFromDB(
    req.user.userId,
    req.params.id,
  );
  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Maintenance type deleted successfully",
    data: result,
  });
});

export const maintenanceTypeController = {
  createMaintenanceType,
  getMaintenanceTypes,
  updateMaintenanceType,
  deleteMaintenanceType,
};