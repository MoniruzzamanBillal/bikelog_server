import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import QueryBuilder from "../../builder/Queryuilder";
import { findOwnedBikeOrThrow } from "../bike/bike.utils";
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

  // ! strip client-controlled "bike"/"isDeleted" keys before they reach QueryBuilder.filter() —
  // ! its .find(queryObj) call merges into the query and a later key wins, so an unsanitized
  // ! `?bike=<otherBikeId>` would silently override the ownership-scoped filter below
  const sanitizedQuery = { ...query };
  delete sanitizedQuery.bike;
  delete sanitizedQuery.isDeleted;

  const accessoriesQuery = new QueryBuilder(
    bikeAccessoryModel.find({ bike: bikeId, isDeleted: false }),
    sanitizedQuery,
  )
    .filter()
    .sort()
    .pagination()
    .field();

  const result = await accessoriesQuery.queryModel;
  const meta = await accessoriesQuery.countTotal();

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
