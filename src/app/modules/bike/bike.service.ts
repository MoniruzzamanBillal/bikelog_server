import { TBike } from "./bike.interface";
import { bikeModel } from "./bike.model";
import { findOwnedBikeOrThrow, bumpOdometerIfHigher } from "./bike.utils";

const createBikeIntoDB = async (payload: Partial<TBike>, userId: string) => {
  const startingOdometer = payload.currentOdometer ?? 0;
  const bikeData = {
    ...payload,
    owner: userId,
    currentOdometer: startingOdometer,
    initialOdometer: startingOdometer,
  };
  const result = await bikeModel.create(bikeData);
  return result;
};

const getBikesFromDB = async (userId: string) => {
  const result = await bikeModel.find({ owner: userId, isDeleted: false });
  return result;
};

const getBikeByIdFromDB = async (id: string, userId: string) => {
  const bike = await findOwnedBikeOrThrow(id, userId);
  return bike;
};

const updateBikeInDB = async (
  id: string,
  userId: string,
  payload: Partial<TBike>,
) => {
  const bike = await findOwnedBikeOrThrow(id, userId);

  const allowedPayload = { ...payload };
  delete allowedPayload.owner;
  delete allowedPayload.currentOdometer;
  delete allowedPayload.initialOdometer;

  Object.assign(bike, allowedPayload);
  await bike.save();

  return bike;
};

const deleteBikeFromDB = async (id: string, userId: string) => {
  const bike = await findOwnedBikeOrThrow(id, userId);
  bike.isDeleted = true;
  await bike.save();
  return bike;
};

export const bikeServices = {
  createBikeIntoDB,
  getBikesFromDB,
  getBikeByIdFromDB,
  updateBikeInDB,
  deleteBikeFromDB,
  bumpOdometerIfHigher,
};