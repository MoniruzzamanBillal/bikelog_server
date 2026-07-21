import httpStatus from "http-status";
import catchAsync from "../../util/catchAsync";
import sendResponse from "../../util/sendResponse";
import { bikeAccessoryServices } from "./bikeAccessory.service";

const createBikeAccessory = catchAsync(async (req, res) => {
  const result = await bikeAccessoryServices.createBikeAccessoryIntoDB(
    req.params.bikeId,
    req.user.userId,
    req.body,
  );

  sendResponse(res, {
    status: httpStatus.CREATED,
    success: true,
    message: "Bike accessory created successfully",
    data: result,
  });
});

const getBikeAccessories = catchAsync(async (req, res) => {
  const { result, meta } = await bikeAccessoryServices.getBikeAccessoriesFromDB(
    req.params.bikeId,
    req.user.userId,
    req.query,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Bike accessories retrieved successfully",
    data: { result, meta },
  });
});

const getBikeAccessoryById = catchAsync(async (req, res) => {
  const result = await bikeAccessoryServices.getBikeAccessoryByIdFromDB(
    req.params.bikeId,
    req.user.userId,
    req.params.id,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Bike accessory retrieved successfully",
    data: result,
  });
});

const updateBikeAccessory = catchAsync(async (req, res) => {
  const result = await bikeAccessoryServices.updateBikeAccessoryInDB(
    req.params.bikeId,
    req.user.userId,
    req.params.id,
    req.body,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Bike accessory updated successfully",
    data: result,
  });
});

const deleteBikeAccessory = catchAsync(async (req, res) => {
  const result = await bikeAccessoryServices.deleteBikeAccessoryFromDB(
    req.params.bikeId,
    req.user.userId,
    req.params.id,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Bike accessory deleted successfully",
    data: result,
  });
});

export const bikeAccessoryController = {
  createBikeAccessory,
  getBikeAccessories,
  getBikeAccessoryById,
  updateBikeAccessory,
  deleteBikeAccessory,
};
