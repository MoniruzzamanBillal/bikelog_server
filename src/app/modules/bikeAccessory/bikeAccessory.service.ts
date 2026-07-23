import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import { findOwnedBikeOrThrow } from "../bike/bike.utils";
import { AccessoryStatus, TAccessoryStatus } from "./bikeAccessory.constant";
import { bikeAccessoryModel } from "./bikeAccessory.model";
import { TBikeAccessory } from "./bikeAccessory.interface";

const createBikeAccessoryIntoDB = async (
  bikeId: string,
  userId: string,
  payload: Partial<TBikeAccessory>,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const accessoryData = {
    ...payload,
    bike: bikeId,
  };

  const accessory = await bikeAccessoryModel.create(accessoryData);

  return accessory;
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
  // ! merging the results, rather than a persisted/derived rank field — this sorts correctly
  // ! on documents that already existed before this change, with no migration step required
  const statusOrder = Object.values(AccessoryStatus);
  const requestedStatuses: TAccessoryStatus[] =
    typeof filterQuery.status === "string" &&
    (statusOrder as string[]).includes(filterQuery.status)
      ? [filterQuery.status as TAccessoryStatus]
      : statusOrder;
  delete filterQuery.status;

  const sortBy =
    (typeof sanitizedQuery.sort === "string" ? sanitizedQuery.sort : "")
      .split(",")
      .join(" ") || "-createdAt";

  const fields =
    (typeof sanitizedQuery.fields === "string" ? sanitizedQuery.fields : "")
      .split(",")
      .join(" ") || "-__v";

  const limit = Number(sanitizedQuery.limit) || 10;
  const page = Number(sanitizedQuery.page) || 1;
  const skip = (page - 1) * limit;

  const baseFilter = { bike: bikeId, isDeleted: false, ...filterQuery };

  const resultsByStatus = await Promise.all(
    requestedStatuses.map((status) =>
      bikeAccessoryModel
        .find({ ...baseFilter, status })
        .sort(sortBy)
        .select(fields),
    ),
  );

  const result = resultsByStatus.flat().slice(skip, skip + limit);

  const meta = await bikeAccessoryModel.countDocuments({
    ...baseFilter,
    status: { $in: requestedStatuses },
  });

  return { result, meta };
};

const getBikeAccessoryByIdFromDB = async (
  bikeId: string,
  userId: string,
  id: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const accessory = await bikeAccessoryModel.findOne({
    _id: id,
    bike: bikeId,
    isDeleted: false,
  });

  if (!accessory) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike accessory not found");
  }

  return accessory;
};

const updateBikeAccessoryInDB = async (
  bikeId: string,
  userId: string,
  id: string,
  payload: Partial<TBikeAccessory>,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const accessory = await bikeAccessoryModel.findOne({
    _id: id,
    bike: bikeId,
    isDeleted: false,
  });

  if (!accessory) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike accessory not found");
  }

  Object.assign(accessory, payload);
  await accessory.save();

  return accessory;
};

const deleteBikeAccessoryFromDB = async (
  bikeId: string,
  userId: string,
  id: string,
) => {
  await findOwnedBikeOrThrow(bikeId, userId);

  const accessory = await bikeAccessoryModel.findOne({
    _id: id,
    bike: bikeId,
    isDeleted: false,
  });

  if (!accessory) {
    throw new AppError(httpStatus.NOT_FOUND, "Bike accessory not found");
  }

  accessory.isDeleted = true;
  await accessory.save();

  return accessory;
};

export const bikeAccessoryServices = {
  createBikeAccessoryIntoDB,
  getBikeAccessoriesFromDB,
  getBikeAccessoryByIdFromDB,
  updateBikeAccessoryInDB,
  deleteBikeAccessoryFromDB,
};
