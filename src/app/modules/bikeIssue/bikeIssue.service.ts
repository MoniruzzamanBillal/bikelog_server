import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import { prisma } from "../../lib/prisma";
import { generateObjectId } from "../../util/generateObjectId";
import { buildPrismaListQuery } from "../../builder/buildPrismaListQuery";
import { findOwnedBikeOrThrow } from "../bike/bike.utils";
import { BikeIssueStatus, TBikeIssueStatus } from "./bikeIssue.constant";
import { TBikeIssue, TBikeIssueImage } from "./bikeIssue.interface";
import { deleteCloudinaryImage } from "../../util/cloudinary";

const toApiShape = <T extends { id: string; bikeId: string }>(issue: T) => ({
  ...issue,
  _id: issue.id,
  bike: issue.bikeId,
});

const getImages = (issue: { images: unknown }): TBikeIssueImage[] =>
  (issue.images as TBikeIssueImage[] | null) ?? [];

const createBikeIssueIntoDB = async (
  bikeId: string,
  userId: string,
  payload: Partial<TBikeIssue>,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const issue = await prisma.bikeIssue.create({
    data: {
      id: generateObjectId(),
      bikeId,
      title: payload.title as string,
      description: payload.description,
      dateReported: payload.dateReported ?? new Date(),
      status: BikeIssueStatus.open,
    },
  });

  return toApiShape(issue);
};

const getBikeIssuesFromDB = async (
  bikeId: string,
  userId: string,
  query: Record<string, unknown>,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  // ! strip client-controlled "bike"/"isDeleted" keys before they reach buildPrismaListQuery —
  // ! it merges whatever's left in query as equality filters, and an unsanitized
  // ! `?bike=<otherBikeId>` would silently override the ownership-scoped filter below
  const sanitizedQuery = { ...query };
  delete sanitizedQuery.bike;
  delete sanitizedQuery.isDeleted;

  const { where, orderBy, skip, take } = buildPrismaListQuery({
    baseWhere: { bikeId, isDeleted: false },
    query: sanitizedQuery,
    defaultSort: "status -dateReported",
  });

  const [result, meta] = await Promise.all([
    prisma.bikeIssue.findMany({ where, orderBy, skip, take }),
    prisma.bikeIssue.count({ where }),
  ]);

  return { result: result.map(toApiShape), meta };
};

const getBikeIssueByIdFromDB = async (
  bikeId: string,
  userId: string,
  id: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const issue = await prisma.bikeIssue.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!issue) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike issue not found");
  }

  return toApiShape(issue);
};

const updateBikeIssueInDB = async (
  bikeId: string,
  userId: string,
  id: string,
  payload: Partial<TBikeIssue>,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const issue = await prisma.bikeIssue.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!issue) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike issue not found");
  }

  const updateData = { ...payload } as Record<string, unknown>;
  delete updateData.status;

  const updated = await prisma.bikeIssue.update({
    where: { id: issue.id },
    data: updateData,
  });

  return toApiShape(updated);
};

const deleteBikeIssueFromDB = async (
  bikeId: string,
  userId: string,
  id: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const issue = await prisma.bikeIssue.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!issue) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike issue not found");
  }

  const updated = await prisma.bikeIssue.update({
    where: { id: issue.id },
    data: { isDeleted: true },
  });

  return toApiShape(updated);
};

// ! open -> resolved when fixed, resolved -> open again if the same problem recurs
const updateBikeIssueStatus = async (
  bikeId: string,
  userId: string,
  id: string,
  status: TBikeIssueStatus,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const issue = await prisma.bikeIssue.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!issue) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike issue not found");
  }

  if (issue.status === status) {
    throw new AppError(httpStatus.BAD_REQUEST, `Issue is already ${status}`);
  }

  const updated = await prisma.bikeIssue.update({
    where: { id: issue.id },
    data: { status },
  });

  return toApiShape(updated);
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

  const issue = await prisma.bikeIssue.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!issue) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike issue not found");
  }

  const newImages: TBikeIssueImage[] = files.map((file) => ({
    _id: generateObjectId(),
    url: file.path,
    publicId: file.filename,
  }));

  const updated = await prisma.bikeIssue.update({
    where: { id: issue.id },
    data: { images: [...getImages(issue), ...newImages] },
  });

  return toApiShape(updated);
};

const deleteBikeIssueImageFromDB = async (
  bikeId: string,
  userId: string,
  id: string,
  imageId: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const issue = await prisma.bikeIssue.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!issue) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike issue not found");
  }

  const existingImages = getImages(issue);
  const targetImage = existingImages.find((image) => image._id === imageId);

  if (!targetImage) {
    throw new AppError(httpStatus.NOT_FOUND, "Image not found");
  }

  await deleteCloudinaryImage(targetImage.publicId);

  const remaining = existingImages.filter((image) => image._id !== imageId);

  const updated = await prisma.bikeIssue.update({
    where: { id: issue.id },
    data: { images: remaining },
  });

  return toApiShape(updated);
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
