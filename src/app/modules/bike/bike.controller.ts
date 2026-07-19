import httpStatus from "http-status";
import catchAsync from "../../util/catchAsync";
import sendResponse from "../../util/sendResponse";
import { bikeServices } from "./bike.service";

const createBike = catchAsync(async (req, res) => {
  const result = await bikeServices.createBikeIntoDB(req.body, req.user.userId);
  sendResponse(res, {
    status: httpStatus.CREATED,
    success: true,
    message: "Bike created successfully",
    data: result,
  });
});

const getBikes = catchAsync(async (req, res) => {
  const result = await bikeServices.getBikesFromDB(req.user.userId);
  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Bikes retrieved successfully",
    data: result,
  });
});

const getBikeById = catchAsync(async (req, res) => {
  const result = await bikeServices.getBikeByIdFromDB(
    req.params.id,
    req.user.userId,
  );
  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Bike retrieved successfully",
    data: result,
  });
});

const updateBike = catchAsync(async (req, res) => {
  const result = await bikeServices.updateBikeInDB(
    req.params.id,
    req.user.userId,
    req.body,
  );
  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Bike updated successfully",
    data: result,
  });
});

const deleteBike = catchAsync(async (req, res) => {
  const result = await bikeServices.deleteBikeFromDB(
    req.params.id,
    req.user.userId,
  );
  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Bike deleted successfully",
    data: result,
  });
});

export const bikeController = {
  createBike,
  getBikes,
  getBikeById,
  updateBike,
  deleteBike,
};