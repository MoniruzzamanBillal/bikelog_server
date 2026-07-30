import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import QueryBuilder from "../../builder/Queryuilder";
import { findOwnedBikeOrThrow } from "../bike/bike.utils";
import { deleteCloudinaryImage, uploadDocumentBuffer } from "../../util/cloudinary";
import { TBikeDocument } from "./bikeDocument.interface";
import { bikeDocumentModel } from "./bikeDocument.model";

const createBikeDocumentIntoDB = async (
  bikeId: string,
  userId: string,
  payload: Partial<TBikeDocument>,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const documentData = {
    ...payload,
    bike: bikeId,
  };

  const document = await bikeDocumentModel.create(documentData);

  return document;
};

const getBikeDocumentsFromDB = async (
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

  const limit = Number(sanitizedQuery.limit) || 10;
  const page = Number(sanitizedQuery.page) || 1;
  const skip = (page - 1) * limit;

  const baseFilter = { bike: bikeId, isDeleted: false };

  // ! client-provided sort fully overrides the default expiry-first ordering below
  if (sanitizedQuery.sort) {
    const documentsQuery = new QueryBuilder(
      bikeDocumentModel.find(baseFilter),
      sanitizedQuery,
    )
      .filter()
      .sort()
      .pagination()
      .field();

    const result = await documentsQuery.queryModel;
    const meta = await documentsQuery.countTotal();

    return { result, meta };
  }

  // ! no single Mongo sort field can express "earliest expiry first, no-expiry documents
  // ! last" (ascending sort treats a missing field as less-than-any-value, i.e. first, not
  // ! last) without an aggregation pipeline — this codebase's house style avoids those (see
  // ! bikeAccessory's getBikeAccessoriesFromDB, spec 13) in favor of one plain find() per
  // ! group, concatenated in a fixed order, then paginated in memory
  const [withExpiry, withoutExpiry, meta] = await Promise.all([
    bikeDocumentModel
      .find({ ...baseFilter, expiryDate: { $ne: null } })
      .sort("expiryDate"),
    bikeDocumentModel
      .find({ ...baseFilter, expiryDate: null })
      .sort("-createdAt"),
    bikeDocumentModel.countDocuments(baseFilter),
  ]);

  const result = [...withExpiry, ...withoutExpiry].slice(skip, skip + limit);

  return { result, meta };
};

const getBikeDocumentByIdFromDB = async (
  bikeId: string,
  userId: string,
  id: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const document = await bikeDocumentModel.findOne({
    _id: id,
    bike: bikeId,
    isDeleted: false,
  });

  if (!document) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike document not found");
  }

  return document;
};

const updateBikeDocumentIntoDB = async (
  bikeId: string,
  userId: string,
  id: string,
  payload: Partial<TBikeDocument>,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const document = await bikeDocumentModel.findOne({
    _id: id,
    bike: bikeId,
    isDeleted: false,
  });

  if (!document) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike document not found");
  }

  Object.assign(document, payload);
  await document.save();

  return document;
};

const deleteBikeDocumentFromDB = async (
  bikeId: string,
  userId: string,
  id: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const document = await bikeDocumentModel.findOne({
    _id: id,
    bike: bikeId,
    isDeleted: false,
  });

  if (!document) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike document not found");
  }

  // ! best-effort cleanup — a failed Cloudinary delete shouldn't block the user's own delete
  if (document.files?.length) {
    await Promise.all(
      document.files.map((file) =>
        deleteCloudinaryImage(file.publicId, file.resourceType),
      ),
    );
  }

  document.isDeleted = true;
  await document.save();

  return document;
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

  const document = await bikeDocumentModel.findOne({
    _id: id,
    bike: bikeId,
    isDeleted: false,
  });

  if (!document) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike document not found");
  }

  // ! uploaded in parallel — this middleware uses memoryStorage (unlike bikeIssue's
  // ! CloudinaryStorage-backed upload.ts), so each buffer needs its own manual upload call
  const uploadedFiles = await Promise.all(
    files.map(async (file) => {
      const { url, publicId, resourceType } = await uploadDocumentBuffer(
        file.buffer,
        file.originalname,
        file.mimetype,
      );
      return {
        url,
        publicId,
        resourceType,
        originalName: file.originalname,
        mimeType: file.mimetype,
      };
    }),
  );

  document.files = [...(document.files ?? []), ...uploadedFiles];
  await document.save();

  return document;
};

const deleteBikeDocumentFileFromDB = async (
  bikeId: string,
  userId: string,
  id: string,
  fileId: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const document = await bikeDocumentModel.findOne({
    _id: id,
    bike: bikeId,
    isDeleted: false,
  });

  if (!document) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike document not found");
  }

  const targetFile = document.files?.find(
    (file) => file._id?.toString() === fileId,
  );

  if (!targetFile) {
    throw new AppError(httpStatus.NOT_FOUND, "File not found");
  }

  await deleteCloudinaryImage(targetFile.publicId, targetFile.resourceType);

  document.files = document.files?.filter(
    (file) => file._id?.toString() !== fileId,
  );
  await document.save();

  return document;
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
