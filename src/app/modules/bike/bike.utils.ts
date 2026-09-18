import { Prisma } from "@prisma/client";
import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import { prisma } from "../../lib/prisma";
import { TBikeManualMeta } from "../bikeManual/bikeManual.interface";

// Returns the raw Prisma row (ownerId, id — NOT API-shaped with _id/owner).
// Consumed internally by 9 other still-Mongoose-backed modules, all of which
// either discard the return value or read a plain scalar field off it —
// never send this directly as an HTTP response body.
export const findOwnedBikeOrThrow = async (bikeId: string, userId: string) => {
  const bike = await prisma.bike.findFirst({
    where: { id: bikeId, ownerId: userId, isDeleted: false },
  });
  if (!bike) throw new AppError(httpStatus.NOT_FOUND, "Bike not found");
  return bike;
};

export const bumpOdometerIfHigher = async (
  bike: { id: string; currentOdometer: number },
  newReading: number,
) => {
  if (newReading > bike.currentOdometer) {
    await prisma.bike.update({
      where: { id: bike.id },
      data: { currentOdometer: newReading },
    });
  }
};

// ! only used by bikeManual.service.ts (replaces its old `bike.manual = ...; bike.save()`
// ! pattern, which broke the moment findOwnedBikeOrThrow stopped returning a Mongoose doc)
export const updateBikeManual = async (
  bikeId: string,
  manual: TBikeManualMeta | null,
) => {
  return prisma.bike.update({
    where: { id: bikeId },
    data: { manual: manual === null ? Prisma.JsonNull : manual },
  });
};
