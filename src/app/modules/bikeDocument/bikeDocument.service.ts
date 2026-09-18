import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import { prisma } from "../../lib/prisma";
import { generateObjectId } from "../../util/generateObjectId";
import { buildPrismaListQuery } from "../../builder/buildPrismaListQuery";
import { findOwnedBikeOrThrow } from "../bike/bike.utils";
import { deleteCloudinaryImage, uploadDocumentBuffer } from "../../util/cloudinary";
import { TBikeDocument, TBikeDocumentFile } from "./bikeDocument.interface";

const toApiShape = <T extends { id: string; bikeId: string }>(doc: T) => ({
  ...doc,
  _id: doc.id,
  bike: doc.bikeId,
});

const getFiles = (doc: { files: unknown }): TBikeDocumentFile[] =>
  (doc.files as TBikeDocumentFile[] | null) ?? [];

const createBikeDocumentIntoDB = async (
  bikeId: string,
  userId: string,
  payload: Partial<TBikeDocument>,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const document = await prisma.bikeDocument.create({
    data: {
      id: generateObjectId(),
      bikeId,
      title: payload.title as string,
      description: payload.description,
      expiryDate: payload.expiryDate,
    },
  });

  return toApiShape(document);
};

const getBikeDocumentsFromDB = async (
  bikeId: string,
  userId: string,
  query: Record<string, unknown>,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  // ! strip client-controlled "bike"/"isDeleted" keys before they reach the filter/query logic —
  // ! an unsanitized `?bike=<otherBikeId>` would otherwise override the ownership-scoped filter below
  const sanitizedQuery = { ...query };
  delete sanitizedQuery.bike;
  delete sanitizedQuery.isDeleted;

  const baseWhere = { bikeId, isDeleted: false };

  // ! client-provided sort fully overrides the default expiry-first ordering below
  if (sanitizedQuery.sort) {
    const { where, orderBy, skip, take } = buildPrismaListQuery({
      baseWhere,
      query: sanitizedQuery,
      defaultSort: "-createdAt", // unused when query.sort is present, kept for signature consistency
    });

    const [result, meta] = await Promise.all([
      prisma.bikeDocument.findMany({ where, orderBy, skip, take }),
      prisma.bikeDocument.count({ where }),
    ]);

    return { result: result.map(toApiShape), meta };
  }

  // ! no single Postgres sort can express "earliest expiry first, no-expiry documents last"
  // ! (ascending sort treats NULL as less-than-any-value, i.e. first, not last) without a
  // ! window function/aggregation — this codebase's house style avoids those (see
  // ! bikeAccessory's getBikeAccessoriesFromDB, spec 13) in favor of one plain findMany() per
  // ! group, concatenated in a fixed order, then paginated in memory
  const limit = Number(sanitizedQuery.limit) || 10;
  const page = Number(sanitizedQuery.page) || 1;
  const skip = (page - 1) * limit;

  const [withExpiry, withoutExpiry, meta] = await Promise.all([
    prisma.bikeDocument.findMany({
      where: { ...baseWhere, expiryDate: { not: null } },
      orderBy: { expiryDate: "asc" },
    }),
    prisma.bikeDocument.findMany({
      where: { ...baseWhere, expiryDate: null },
      orderBy: { createdAt: "desc" },
    }),
    prisma.bikeDocument.count({ where: baseWhere }),
  ]);

  const result = [...withExpiry, ...withoutExpiry]
    .slice(skip, skip + limit)
    .map(toApiShape);

  return { result, meta };
};

const getBikeDocumentByIdFromDB = async (
  bikeId: string,
  userId: string,
  id: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const document = await prisma.bikeDocument.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!document) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike document not found");
  }

  return toApiShape(document);
};

const updateBikeDocumentIntoDB = async (
  bikeId: string,
  userId: string,
  id: string,
  payload: Partial<TBikeDocument>,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const document = await prisma.bikeDocument.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!document) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike document not found");
  }

  const updated = await prisma.bikeDocument.update({
    where: { id: document.id },
    data: payload,
  });

  return toApiShape(updated);
};

const deleteBikeDocumentFromDB = async (
  bikeId: string,
  userId: string,
  id: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const document = await prisma.bikeDocument.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!document) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike document not found");
  }

  // ! best-effort cleanup — a failed Cloudinary delete shouldn't block the user's own delete
  const files = getFiles(document);
  if (files.length) {
    await Promise.all(
      files.map((file) => deleteCloudinaryImage(file.publicId, file.resourceType)),
    );
  }

  const updated = await prisma.bikeDocument.update({
    where: { id: document.id },
    data: { isDeleted: true },
  });

  return toApiShape(updated);
};

const addBikeDocumentFilesIntoDB = async (
  bikeId: string,
  userId: string,
  id: string,
  files: Express.Multer.File[] | undefined,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  if (!files || files.length === 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "At least one image or PDF file is required",
    );
  }

  const document = await prisma.bikeDocument.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!document) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike document not found");
  }

  // ! uploaded in parallel — this middleware uses memoryStorage (unlike bikeIssue's
  // ! CloudinaryStorage-backed upload.ts), so each buffer needs its own manual upload call
  const uploadedFiles: TBikeDocumentFile[] = await Promise.all(
    files.map(async (file) => {
      const { url, publicId, resourceType } = await uploadDocumentBuffer(
        file.buffer,
        file.originalname,
        file.mimetype,
      );
      return {
        _id: generateObjectId(),
        url,
        publicId,
        resourceType,
        originalName: file.originalname,
        mimeType: file.mimetype,
      };
    }),
  );

  const updated = await prisma.bikeDocument.update({
    where: { id: document.id },
    data: { files: [...getFiles(document), ...uploadedFiles] },
  });

  return toApiShape(updated);
};

const deleteBikeDocumentFileFromDB = async (
  bikeId: string,
  userId: string,
  id: string,
  fileId: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const document = await prisma.bikeDocument.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!document) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike document not found");
  }

  const existingFiles = getFiles(document);
  const targetFile = existingFiles.find((file) => file._id === fileId);

  if (!targetFile) {
    throw new AppError(httpStatus.NOT_FOUND, "File not found");
  }

  await deleteCloudinaryImage(targetFile.publicId, targetFile.resourceType);

  const remaining = existingFiles.filter((file) => file._id !== fileId);

  const updated = await prisma.bikeDocument.update({
    where: { id: document.id },
    data: { files: remaining },
  });

  return toApiShape(updated);
};

export const bikeDocumentServices = {
  createBikeDocumentIntoDB,
  getBikeDocumentsFromDB,
  getBikeDocumentByIdFromDB,
  updateBikeDocumentIntoDB,
  deleteBikeDocumentFromDB,
  addBikeDocumentFilesIntoDB,
  deleteBikeDocumentFileFromDB,
};
