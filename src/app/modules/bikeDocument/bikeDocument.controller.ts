import httpStatus from "http-status";
import catchAsync from "../../util/catchAsync";
import sendResponse from "../../util/sendResponse";
import { bikeDocumentServices } from "./bikeDocument.service";

const createBikeDocument = catchAsync(async (req, res) => {
  const result = await bikeDocumentServices.createBikeDocumentIntoDB(
    req.params.bikeId,
    req.user.userId,
    req.body,
  );

  sendResponse(res, {
    status: httpStatus.CREATED,
    success: true,
    message: "Bike document created successfully",
    data: result,
  });
});

const getBikeDocuments = catchAsync(async (req, res) => {
  const { result, meta } = await bikeDocumentServices.getBikeDocumentsFromDB(
    req.params.bikeId,
    req.user.userId,
    req.query,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Bike documents retrieved successfully",
    data: { result, meta },
  });
});

const getBikeDocumentById = catchAsync(async (req, res) => {
  const result = await bikeDocumentServices.getBikeDocumentByIdFromDB(
    req.params.bikeId,
    req.user.userId,
    req.params.id,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Bike document retrieved successfully",
    data: result,
  });
});

const updateBikeDocument = catchAsync(async (req, res) => {
  const result = await bikeDocumentServices.updateBikeDocumentIntoDB(
    req.params.bikeId,
    req.user.userId,
    req.params.id,
    req.body,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Bike document updated successfully",
    data: result,
  });
});

const deleteBikeDocument = catchAsync(async (req, res) => {
  const result = await bikeDocumentServices.deleteBikeDocumentFromDB(
    req.params.bikeId,
    req.user.userId,
    req.params.id,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Bike document deleted successfully",
    data: result,
  });
});

const addBikeDocumentFiles = catchAsync(async (req, res) => {
  const result = await bikeDocumentServices.addBikeDocumentFilesIntoDB(
    req.params.bikeId,
    req.user.userId,
    req.params.id,
    req.files as Express.Multer.File[] | undefined,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Bike document files added successfully",
    data: result,
  });
});

const deleteBikeDocumentFile = catchAsync(async (req, res) => {
  const result = await bikeDocumentServices.deleteBikeDocumentFileFromDB(
    req.params.bikeId,
    req.user.userId,
    req.params.id,
    req.params.fileId,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Bike document file deleted successfully",
    data: result,
  });
});

export const bikeDocumentController = {
  createBikeDocument,
  getBikeDocuments,
  getBikeDocumentById,
  updateBikeDocument,
  deleteBikeDocument,
  addBikeDocumentFiles,
  deleteBikeDocumentFile,
};
