import { Prisma } from "@prisma/client";
import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import { prisma } from "../../lib/prisma";
import { generateObjectId } from "../../util/generateObjectId";
import { findOwnedBikeOrThrow } from "../bike/bike.utils";
import { AccessoryStatus, TAccessoryStatus } from "./bikeAccessory.constant";
import { TBikeAccessory } from "./bikeAccessory.interface";
import { deleteCloudinaryImage } from "../../util/cloudinary";

const toApiShape = <
  T extends { id: string; bikeId: string; price: unknown },
>(
  accessory: T,
) => ({
  ...accessory,
  _id: accessory.id,
  bike: accessory.bikeId,
  price: accessory.price !== null ? Number(accessory.price) : null,
});

const createBikeAccessoryIntoDB = async (
  bikeId: string,
  userId: string,
  payload: Partial<TBikeAccessory>,
) => {
  const bike = await findOwnedBikeOrThrow(bikeId, userId);

  if (payload.status === AccessoryStatus.purchased && !payload.price) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Price is required when marking an accessory as purchased",
    );
  }

  const accessory = await prisma.bikeAccessory.create({
    data: {
      id: generateObjectId(),
      bikeId,
      name: payload.name as string,
      urgency: payload.urgency as TBikeAccessory["urgency"],
      status: payload.status,
      price: payload.price,
      ...(payload.status === AccessoryStatus.purchased
        ? { purchaseDate: new Date() }
        : {}),
    },
  });

  return { accessory: toApiShape(accessory), bikeNickname: bike.nickname };
};

const getBikeAccessoriesFromDB = async (
  bikeId: string,
  userId: string,
  query: Record<string, unknown>,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  // ! strip client-controlled "bike"/"isDeleted" keys before they reach the filter object —
  // ! an unsanitized `?bike=<otherBikeId>` would otherwise override the ownership-scoped filter below
  const sanitizedQuery = { ...query };
  delete sanitizedQuery.bike;
  delete sanitizedQuery.isDeleted;

  const filterQuery: Record<string, unknown> = { ...sanitizedQuery };
  delete filterQuery.searchTerm;
  delete filterQuery.sort;
  delete filterQuery.limit;
  delete filterQuery.page;
  delete filterQuery.fields;

  // ! grouping is done by running one query per status (in the enum's declared order) and
  // ! merging the results, rather than relying on Postgres enum ordering (not guaranteed to
  // ! match declaration order) or a $group-style aggregation (avoided per house style, see
  // ! context/architecture.md) — same strategy spec 13 chose, ported exactly, not "simplified"
  // ! into a single orderBy: [{status: ...}, ...] query
  const statusOrder = Object.values(AccessoryStatus);
  const requestedStatuses: TAccessoryStatus[] =
    typeof filterQuery.status === "string" &&
    (statusOrder as string[]).includes(filterQuery.status)
      ? [filterQuery.status as TAccessoryStatus]
      : statusOrder;
  delete filterQuery.status;

  const sortStr =
    (typeof sanitizedQuery.sort === "string" ? sanitizedQuery.sort : "") ||
    "-createdAt";
  const orderBy = sortStr
    .trim()
    .split(/[\s,]+/)
    .map((field) =>
      field.startsWith("-")
        ? { [field.slice(1)]: "desc" as const }
        : { [field]: "asc" as const },
    );

  const limit = Number(sanitizedQuery.limit) || 10;
  const page = Number(sanitizedQuery.page) || 1;
  const skip = (page - 1) * limit;

  const baseWhere = { bikeId, isDeleted: false, ...filterQuery };

  const resultsByStatus = await Promise.all(
    requestedStatuses.map((status) =>
      prisma.bikeAccessory.findMany({
        where: { ...baseWhere, status },
        orderBy,
      }),
    ),
  );

  const result = resultsByStatus
    .flat()
    .slice(skip, skip + limit)
    .map(toApiShape);

  const meta = await prisma.bikeAccessory.count({
    where: { ...baseWhere, status: { in: requestedStatuses } },
  });

  return { result, meta };
};

const getBikeAccessoryByIdFromDB = async (
  bikeId: string,
  userId: string,
  id: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const accessory = await prisma.bikeAccessory.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!accessory) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike accessory not found");
  }

  return toApiShape(accessory);
};

const updateBikeAccessoryInDB = async (
  bikeId: string,
  userId: string,
  id: string,
  payload: Partial<TBikeAccessory>,
) => {
  const bike = await findOwnedBikeOrThrow(bikeId, userId);

  const accessory = await prisma.bikeAccessory.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!accessory) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike accessory not found");
  }

  // ! once purchased, status is a one-way permanent lock — every other field stays editable
  if (
    accessory.status === AccessoryStatus.purchased &&
    payload.status !== undefined &&
    payload.status !== AccessoryStatus.purchased
  ) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "This accessory is already marked as purchased and its status cannot be changed",
    );
  }

  const existingPrice =
    accessory.price !== null ? Number(accessory.price) : undefined;
  const resultingStatus = payload.status ?? accessory.status;
  const resultingPrice = payload.price ?? existingPrice;

  if (resultingStatus === AccessoryStatus.purchased && !resultingPrice) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Price is required when marking an accessory as purchased",
    );
  }

  const updateData: Record<string, unknown> = { ...payload };

  // ! stamp purchaseDate exactly once, at the moment status actually transitions into
  // ! purchased — never re-stamped afterward, since the lock above guarantees this only
  // ! ever fires once per accessory
  const justPurchased =
    accessory.status !== AccessoryStatus.purchased &&
    resultingStatus === AccessoryStatus.purchased;

  if (justPurchased) {
    updateData.purchaseDate = new Date();
  }

  const updated = await prisma.bikeAccessory.update({
    where: { id: accessory.id },
    data: updateData,
  });

  return {
    accessory: toApiShape(updated),
    justPurchased,
    bikeNickname: bike.nickname,
  };
};

const deleteBikeAccessoryFromDB = async (
  bikeId: string,
  userId: string,
  id: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const accessory = await prisma.bikeAccessory.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!accessory) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike accessory not found");
  }

  const updated = await prisma.bikeAccessory.update({
    where: { id: accessory.id },
    data: { isDeleted: true },
  });

  return toApiShape(updated);
};

const uploadBikeAccessoryImageIntoDB = async (
  bikeId: string,
  userId: string,
  id: string,
  file: Express.Multer.File | undefined,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  if (!file) {
    throw new AppError(httpStatus.BAD_REQUEST, "Image file is required");
  }

  const accessory = await prisma.bikeAccessory.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!accessory) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike accessory not found");
  }

  const existingProductImage = accessory.productImage as {
    url: string;
    publicId: string;
  } | null;

  if (existingProductImage) {
    await deleteCloudinaryImage(existingProductImage.publicId);
  }

  const updated = await prisma.bikeAccessory.update({
    where: { id: accessory.id },
    data: { productImage: { url: file.path, publicId: file.filename } },
  });

  return toApiShape(updated);
};

const deleteBikeAccessoryImageFromDB = async (
  bikeId: string,
  userId: string,
  id: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const accessory = await prisma.bikeAccessory.findFirst({
    where: { id, bikeId, isDeleted: false },
  });

  if (!accessory) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike accessory not found");
  }

  const existingProductImage = accessory.productImage as {
    url: string;
    publicId: string;
  } | null;

  if (!existingProductImage) {
    throw new AppError(httpStatus.NOT_FOUND, "Product image not found");
  }

  await deleteCloudinaryImage(existingProductImage.publicId);

  const updated = await prisma.bikeAccessory.update({
    where: { id: accessory.id },
    data: { productImage: Prisma.JsonNull },
  });

  return toApiShape(updated);
};

export const bikeAccessoryServices = {
  createBikeAccessoryIntoDB,
  getBikeAccessoriesFromDB,
  getBikeAccessoryByIdFromDB,
  updateBikeAccessoryInDB,
  deleteBikeAccessoryFromDB,
  uploadBikeAccessoryImageIntoDB,
  deleteBikeAccessoryImageFromDB,
};
