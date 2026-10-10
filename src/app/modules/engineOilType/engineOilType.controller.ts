import httpStatus from "http-status";
import catchAsync from "../../util/catchAsync";
import sendResponse from "../../util/sendResponse";
import { engineOilTypeServices } from "./engineOilType.service";

// ! Spec 46 §D: `req.user.userId` is now the first argument to every service call — these
// ! handlers previously never read `req.user`, which is how the catalog ended up global.

const createEngineOilType = catchAsync(async (req, res) => {
  const result = await engineOilTypeServices.createEngineOilTypeIntoDB(
    req.user.userId,
    req.body,
  );
  sendResponse(res, {
    status: httpStatus.CREATED,
    success: true,
    message: "Engine oil type created successfully",
    data: result,
  });
});

const getEngineOilTypes = catchAsync(async (req, res) => {
  const result = await engineOilTypeServices.getEngineOilTypesFromDB(
    req.user.userId,
  );
  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Engine oil types retrieved successfully",
    data: result,
  });
});

const updateEngineOilType = catchAsync(async (req, res) => {
  const result = await engineOilTypeServices.updateEngineOilTypeInDB(
    req.user.userId,
    req.params.id,
    req.body,
  );
  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Engine oil type updated successfully",
    data: result,
  });
});

const deleteEngineOilType = catchAsync(async (req, res) => {
  const result = await engineOilTypeServices.deleteEngineOilTypeFromDB(
    req.user.userId,
    req.params.id,
  );
  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Engine oil type deleted successfully",
    data: result,
  });
});

export const engineOilTypeController = {
  createEngineOilType,
  getEngineOilTypes,
  updateEngineOilType,
  deleteEngineOilType,
};