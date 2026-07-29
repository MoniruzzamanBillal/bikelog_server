import httpStatus from "http-status";
import catchAsync from "../../util/catchAsync";
import sendResponse from "../../util/sendResponse";
import { bikeManualServices } from "./bikeManual.service";

const uploadBikeManual = catchAsync(async (req, res) => {
  const result = await bikeManualServices.uploadBikeManualIntoDB(
    req.params.bikeId,
    req.user.userId,
    req.file,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Bike manual uploaded successfully",
    data: result,
  });
});

const getBikeManual = catchAsync(async (req, res) => {
  const result = await bikeManualServices.getBikeManualMetaFromDB(
    req.params.bikeId,
    req.user.userId,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Bike manual metadata retrieved successfully",
    data: result,
  });
});

const deleteBikeManual = catchAsync(async (req, res) => {
  const result = await bikeManualServices.deleteBikeManualFromDB(
    req.params.bikeId,
    req.user.userId,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Bike manual deleted successfully",
    data: result,
  });
});

export const bikeManualController = {
  uploadBikeManual,
  getBikeManual,
  deleteBikeManual,
};
