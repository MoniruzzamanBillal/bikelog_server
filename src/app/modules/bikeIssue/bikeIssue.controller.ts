import httpStatus from "http-status";
import catchAsync from "../../util/catchAsync";
import sendResponse from "../../util/sendResponse";
import { bikeIssueServices } from "./bikeIssue.service";

const createBikeIssue = catchAsync(async (req, res) => {
  const result = await bikeIssueServices.createBikeIssueIntoDB(
    req.params.bikeId,
    req.user.userId,
    req.body,
  );

  sendResponse(res, {
    status: httpStatus.CREATED,
    success: true,
    message: "Bike issue created successfully",
    data: result,
  });
});

const getBikeIssues = catchAsync(async (req, res) => {
  const { result, meta } = await bikeIssueServices.getBikeIssuesFromDB(
    req.params.bikeId,
    req.user.userId,
    req.query,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Bike issues retrieved successfully",
    data: { result, meta },
  });
});

const getBikeIssueById = catchAsync(async (req, res) => {
  const result = await bikeIssueServices.getBikeIssueByIdFromDB(
    req.params.bikeId,
    req.user.userId,
    req.params.id,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Bike issue retrieved successfully",
    data: result,
  });
});

const updateBikeIssue = catchAsync(async (req, res) => {
  const result = await bikeIssueServices.updateBikeIssueInDB(
    req.params.bikeId,
    req.user.userId,
    req.params.id,
    req.body,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Bike issue updated successfully",
    data: result,
  });
});

const deleteBikeIssue = catchAsync(async (req, res) => {
  const result = await bikeIssueServices.deleteBikeIssueFromDB(
    req.params.bikeId,
    req.user.userId,
    req.params.id,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Bike issue deleted successfully",
    data: result,
  });
});

const updateBikeIssueStatus = catchAsync(async (req, res) => {
  const result = await bikeIssueServices.updateBikeIssueStatus(
    req.params.bikeId,
    req.user.userId,
    req.params.id,
    req.body?.status,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Bike issue status updated successfully",
    data: result,
  });
});

export const bikeIssueController = {
  createBikeIssue,
  getBikeIssues,
  getBikeIssueById,
  updateBikeIssue,
  deleteBikeIssue,
  updateBikeIssueStatus,
};
