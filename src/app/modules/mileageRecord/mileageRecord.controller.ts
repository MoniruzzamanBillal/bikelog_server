import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import catchAsync from "../../util/catchAsync";
import sendResponse from "../../util/sendResponse";
import { mileageRecordServices } from "./mileageRecord.service";
import { findOwnedBikeOrThrow } from "../bike/bike.utils";

const getMileageRecords = catchAsync(async (req, res) => {
  await findOwnedBikeOrThrow(req.params.bikeId, req.user.userId);

  const result = await mileageRecordServices.getMileageRecordsFromDB(req.params.bikeId);

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Mileage records retrieved successfully",
    data: result,
  });
});

const getMonthlyMileage = catchAsync(async (req, res) => {
  await findOwnedBikeOrThrow(req.params.bikeId, req.user.userId);

  const targetMonth = req.query.targetMonth as string;

  if (!targetMonth) {
    throw new AppError(httpStatus.BAD_REQUEST, "targetMonth query parameter is required (format: YYYY-MM)");
  }

  const result = await mileageRecordServices.getMonthlyMileageFromDB(req.params.bikeId, targetMonth);

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Monthly mileage retrieved successfully",
    data: result,
  });
});

const getYearlyMileage = catchAsync(async (req, res) => {
  await findOwnedBikeOrThrow(req.params.bikeId, req.user.userId);

  const targetYear = req.query.targetYear as string;

  if (!targetYear) {
    throw new AppError(httpStatus.BAD_REQUEST, "targetYear query parameter is required (format: YYYY)");
  }

  const result = await mileageRecordServices.getYearlyMileageFromDB(req.params.bikeId, targetYear);

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Yearly mileage retrieved successfully",
    data: result,
  });
});

const getLifetimeMileage = catchAsync(async (req, res) => {
  await findOwnedBikeOrThrow(req.params.bikeId, req.user.userId);

  const result = await mileageRecordServices.getLifetimeMileageFromDB(req.params.bikeId);

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Lifetime mileage retrieved successfully",
    data: result,
  });
});

export const mileageRecordController = {
  getMileageRecords,
  getMonthlyMileage,
  getYearlyMileage,
  getLifetimeMileage,
};