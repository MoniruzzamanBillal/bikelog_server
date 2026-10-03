import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import { prisma } from "../../lib/prisma";
import { generateObjectId } from "../../util/generateObjectId";
import { TBike } from "./bike.interface";
import { bumpOdometerIfHigher, findOwnedBikeOrThrow } from "./bike.utils";

// every Bike row returned to a controller gets both the Prisma-era `id`→`_id`
// remap (spec 31 decision A) and the relational `ownerId`→`owner` remap that
// both clients' TBike type still requires (spec 32 decision A)
const toApiShape = <T extends { id: string; ownerId: string }>(bike: T) => ({
  ...bike,
  _id: bike.id,
  owner: bike.ownerId,
});

const createBikeIntoDB = async (payload: Partial<TBike>, userId: string) => {
  const startingOdometer = payload.currentOdometer ?? 0;
  const bike = await prisma.bike.create({
    data: {
      id: generateObjectId(),
      nickname: payload.nickname as string,
      brand: payload.brand as string,
      model: payload.model as string,
      registrationNumber: payload.registrationNumber as string,
      purchaseDate: payload.purchaseDate as Date,
      fuelTankCapacityLiters: payload.fuelTankCapacityLiters as number,
      ownerId: userId,
      currentOdometer: startingOdometer,
      initialOdometer: startingOdometer,
    },
  });
  return toApiShape(bike);
};

const getBikesFromDB = async (userId: string) => {
  const result = await prisma.bike.findMany({
    where: { ownerId: userId, isDeleted: false },
  });
  return result.map(toApiShape);
};

const getBikeByIdFromDB = async (id: string, userId: string) => {
  const bike = await findOwnedBikeOrThrow(id, userId);
  return toApiShape(bike);
};

const updateBikeInDB = async (
  id: string,
  userId: string,
  payload: Partial<TBike>,
) => {
  const bike = await findOwnedBikeOrThrow(id, userId);

  // ! defensive strip — currentOdometer is technically a valid field on
  // ! updateBikeSchema, but this endpoint has never allowed writing it
  // ! directly; port that behavior verbatim, don't "fix" it into editable
  const allowedPayload = { ...payload } as Record<string, unknown>;
  delete allowedPayload.owner;
  delete allowedPayload.currentOdometer;
  delete allowedPayload.initialOdometer;

  const updated = await prisma.bike.update({
    where: { id: bike.id },
    data: allowedPayload,
  });

  return toApiShape(updated);
};

// ! manual "my odometer is now X" update. Only ever moves currentOdometer upward (equal is
// ! allowed, so a repeat submit is idempotent). The `lte` guard lives in the write itself
// ! rather than being checked against the row read above, so a concurrent fuel-log bump or a
// ! second request can't be overwritten with a stale lower value. initialOdometer is never touched.
const updateOdometerInDB = async (
  id: string,
  userId: string,
  newReading: number,
) => {
  const bike = await findOwnedBikeOrThrow(id, userId);

  const { count } = await prisma.bike.updateMany({
    where: {
      id: bike.id,
      ownerId: userId,
      isDeleted: false,
      currentOdometer: { lte: newReading },
    },
    data: { currentOdometer: newReading },
  });

  if (count === 0) {
    // ! re-read so the message shows the live value, in case a concurrent write raised it
    const latest = await findOwnedBikeOrThrow(id, userId);
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Odometer can't be lower than the current reading (${latest.currentOdometer} km)`,
    );
  }

  const updated = await findOwnedBikeOrThrow(id, userId);
  return toApiShape(updated);
};

const deleteBikeFromDB = async (id: string, userId: string) => {
  const bike = await findOwnedBikeOrThrow(id, userId);
  const updated = await prisma.bike.update({
    where: { id: bike.id },
    data: { isDeleted: true },
  });
  return toApiShape(updated);
};

export const bikeServices = {
  createBikeIntoDB,
  getBikesFromDB,
  getBikeByIdFromDB,
  updateBikeInDB,
  updateOdometerInDB,
  deleteBikeFromDB,
  bumpOdometerIfHigher,
};
