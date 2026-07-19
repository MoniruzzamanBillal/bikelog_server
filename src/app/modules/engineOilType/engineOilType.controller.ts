import httpStatus from "http-status";
import catchAsync from "../../util/catchAsync";
import sendResponse from "../../util/sendResponse";
import { engineOilTypeServices } from "./engineOilType.service";

const createEngineOilType = catchAsync(async (req, res) => {
  const result = await engineOilTypeServices.createEngineOilTypeIntoDB(req.body);
  sendResponse(res, {
    status: httpStatus.CREATED,
    success: true,
    message: "Engine oil type created successfully",
    data: result,
  });
});

const getEngineOilTypes = catchAsync(async (req, res) => {
  const result = await engineOilTypeServices.getEngineOilTypesFromDB();
  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Engine oil types retrieved successfully",
    data: result,
  });
});

export const engineOilTypeController = {
  createEngineOilType,
  getEngineOilTypes,
};