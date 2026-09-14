import { TBike } from "./bike.interface";
import { prisma } from "../../lib/prisma";
import { generateObjectId } from "../../util/generateObjectId";
import {
  findOwnedBikeOrThrow,
  bumpOdometerIfHigher,
} from "./bike.utils";

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
  deleteBikeFromDB,
  bumpOdometerIfHigher,
};
