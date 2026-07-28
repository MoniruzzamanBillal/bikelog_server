import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import QueryBuilder from "../../builder/Queryuilder";
import { findOwnedBikeOrThrow } from "../bike/bike.utils";
import { BikeIssueStatus, TBikeIssueStatus } from "./bikeIssue.constant";
import { TBikeIssue } from "./bikeIssue.interface";
import { bikeIssueModel } from "./bikeIssue.model";
import { deleteCloudinaryImage } from "../../util/cloudinary";

const createBikeIssueIntoDB = async (
  bikeId: string,
  userId: string,
  payload: Partial<TBikeIssue>,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const issueData = {
    ...payload,
    bike: bikeId,
    status: BikeIssueStatus.open,

    dateReported: payload.dateReported ?? new Date(),
  };

  const issue = await bikeIssueModel.create(issueData);

  return issue;
};

const getBikeIssuesFromDB = async (
  bikeId: string,
  userId: string,
  query: Record<string, unknown>,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  // ! strip client-controlled "bike"/"isDeleted" keys before they reach QueryBuilder.filter() —
  // ! its .find(queryObj) call merges into the query and a later key wins, so an unsanitized
  // ! `?bike=<otherBikeId>` would silently override the ownership-scoped filter below
  const sanitizedQuery = { ...query };
  delete sanitizedQuery.bike;
  delete sanitizedQuery.isDeleted;

  const issuesQuery = new QueryBuilder(
    bikeIssueModel.find({ bike: bikeId, isDeleted: false }),
    sanitizedQuery,
  )
    .filter()
    .sort("status -dateReported")
    .pagination()
    .field();

  const result = await issuesQuery.queryModel;
  const meta = await issuesQuery.countTotal();

  return { result, meta };
};

const getBikeIssueByIdFromDB = async (
  bikeId: string,
  userId: string,
  id: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const issue = await bikeIssueModel.findOne({
    _id: id,
    bike: bikeId,
    isDeleted: false,
  });

  if (!issue) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike issue not found");
  }

  return issue;
};

const updateBikeIssueInDB = async (
  bikeId: string,
  userId: string,
  id: string,
  payload: Partial<TBikeIssue>,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const issue = await bikeIssueModel.findOne({
    _id: id,
    bike: bikeId,
    isDeleted: false,
  });

  if (!issue) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike issue not found");
  }

  const updateData = { ...payload };
  delete updateData.status;

  Object.assign(issue, updateData);
  await issue.save();

  return issue;
};

const deleteBikeIssueFromDB = async (
  bikeId: string,
  userId: string,
  id: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const issue = await bikeIssueModel.findOne({
    _id: id,
    bike: bikeId,
    isDeleted: false,
  });

  if (!issue) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike issue not found");
  }

  issue.isDeleted = true;
  await issue.save();

  return issue;
};

// ! open -> resolved when fixed, resolved -> open again if the same problem recurs
const updateBikeIssueStatus = async (
  bikeId: string,
  userId: string,
  id: string,
  status: TBikeIssueStatus,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const issue = await bikeIssueModel.findOne({
    _id: id,
    bike: bikeId,
    isDeleted: false,
  });

  if (!issue) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike issue not found");
  }

  if (issue.status === status) {
    throw new AppError(httpStatus.BAD_REQUEST, `Issue is already ${status}`);
  }

  issue.status = status;
  await issue.save();

  return issue;
};

const addBikeIssueImagesIntoDB = async (
  bikeId: string,
  userId: string,
  id: string,
  files: Express.Multer.File[] | undefined,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  if (!files || files.length === 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "At least one image file is required",
    );
  }

  const issue = await bikeIssueModel.findOne({
    _id: id,
    bike: bikeId,
    isDeleted: false,
  });

  if (!issue) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike issue not found");
  }

  const newImages = files.map((file) => ({
    url: file.path,
    publicId: file.filename,
  }));

  issue.images = [...(issue.images ?? []), ...newImages];
  await issue.save();

  return issue;
};

const deleteBikeIssueImageFromDB = async (
  bikeId: string,
  userId: string,
  id: string,
  imageId: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const issue = await bikeIssueModel.findOne({
    _id: id,
    bike: bikeId,
    isDeleted: false,
  });

  if (!issue) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike issue not found");
  }

  const targetImage = issue.images?.find(
    (image) => image._id?.toString() === imageId,
  );

  if (!targetImage) {
    throw new AppError(httpStatus.NOT_FOUND, "Image not found");
  }

  await deleteCloudinaryImage(targetImage.publicId);

  issue.images = issue.images?.filter(
    (image) => image._id?.toString() !== imageId,
  );
  await issue.save();

  return issue;
};

export const bikeIssueServices = {
  createBikeIssueIntoDB,
  getBikeIssuesFromDB,
  getBikeIssueByIdFromDB,
  updateBikeIssueInDB,
  deleteBikeIssueFromDB,
  updateBikeIssueStatus,
  addBikeIssueImagesIntoDB,
  deleteBikeIssueImageFromDB,
};
