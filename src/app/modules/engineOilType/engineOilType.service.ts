import { Prisma } from "@prisma/client";
import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import { prisma } from "../../lib/prisma";
import { generateObjectId } from "../../util/generateObjectId";
import { TEngineOilType } from "./engineOilType.interface";
import { findOwnedEngineOilTypeOrThrow } from "./engineOilType.utils";

// ! Spec 46: this catalog is per-user, not global. Every query below must carry BOTH
// ! `ownerId` and `isDeleted: false`. `ownerId` is never read from the request body (it is
// ! deliberately absent from the Zod schemas and from TEngineOilType); it always comes
// ! from the verified JWT.

const createEngineOilTypeIntoDB = async (
  userId: string,
  payload: Partial<TEngineOilType>,
) => {
  // ! Spec 41 §I/§F, re-scoped by spec 46 §B: the unique is now `(ownerId, name)` and still
  // ! covers soft-deleted rows, so re-adding a name THIS USER deleted would otherwise hit
  // ! P2002 and claim it "already exists" about a row they can no longer see. Revive their
  // ! row, preserving its id so their historical logs stay correctly labelled.
  const softDeleted = await prisma.engineOilType.findFirst({
    where: { ownerId: userId, name: payload.name as string, isDeleted: true },
  });

  if (softDeleted) {
    const revived = await prisma.engineOilType.update({
      where: { id: softDeleted.id },
      data: {
        isDeleted: false,
        suggestedIntervalKm: payload.suggestedIntervalKm,
      },
    });
    return { ...revived, _id: revived.id };
  }

  try {
    const result = await prisma.engineOilType.create({
      data: {
        id: generateObjectId(),
        ownerId: userId,
        name: payload.name as string,
        suggestedIntervalKm: payload.suggestedIntervalKm as number,
      },
    });
    return { ...result, _id: result.id };
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      // ! Message unchanged — it now fires on `(ownerId, name)`, so it is finally true
      // ! from the user's point of view.
      throw new AppError(
        httpStatus.CONFLICT,
        "An engine oil type with this name already exists",
      );
    }
    throw error;
  }
};

const getEngineOilTypesFromDB = async (userId: string) => {
  const result = await prisma.engineOilType.findMany({
    where: { ownerId: userId, isDeleted: false },
    orderBy: { name: "asc" },
  });
  // ! An empty array is a legitimate response for a brand-new user (spec 46 decision 2).
  return result.map((item) => ({ ...item, _id: item.id }));
};

const updateEngineOilTypeInDB = async (
  userId: string,
  id: string,
  payload: Partial<TEngineOilType>,
) => {
  // ! Spec 41 §G + spec 46 §D/§E: one lookup covers unknown id, soft-deleted row and
  // ! another user's row — all as a 404.
  await findOwnedEngineOilTypeOrThrow(id, userId);

  try {
    const result = await prisma.engineOilType.update({
      where: { id },
      data: {
        name: payload.name,
        suggestedIntervalKm: payload.suggestedIntervalKm,
      },
    });
    return { ...result, _id: result.id };
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new AppError(
        httpStatus.CONFLICT,
        "An engine oil type with this name already exists",
      );
    }
    throw error;
  }
};

const deleteEngineOilTypeFromDB = async (userId: string, id: string) => {
  const existing = await findOwnedEngineOilTypeOrThrow(id, userId);

  // ! Spec 41 §I / decision 2: same rule as the maintenance catalog — only LIVE logs block.
  // ! MaintenanceLog.oilTypeId is nullable (String?), so a log that recorded no oil type
  // ! simply never matches here; `count` handles that for free, no null-guard needed.
  // ! Runs BEFORE the update: globalErrorHandler has no P2003 branch, so an unguarded FK
  // ! violation would reach the client as a generic 500.
  // ! Spec 46 §D: deliberately NOT joined through to the bike's owner. `id` has just been
  // ! proven to belong to `userId`, so every log that can match is necessarily this
  // ! user's. An owner join here would be redundant, not a hardening. Don't add one.
  const inUse = await prisma.maintenanceLog.count({
    where: { oilTypeId: id, isDeleted: false },
  });

  if (inUse > 0) {
    // ! User-facing copy — shown verbatim in the clients' warning toast. Byte-identical
    // ! to pre-spec-46.
    throw new AppError(
      httpStatus.CONFLICT,
      `"${existing.name}" is used by ${inUse} maintenance log${
        inUse === 1 ? "" : "s"
      } and can't be deleted. Remove or re-assign ${
        inUse === 1 ? "it" : "them"
      } first.`,
    );
  }

  const result = await prisma.engineOilType.update({
    where: { id },
    data: { isDeleted: true },
  });
  return { ...result, _id: result.id };
};

export const engineOilTypeServices = {
  createEngineOilTypeIntoDB,
  getEngineOilTypesFromDB,
  updateEngineOilTypeInDB,
  deleteEngineOilTypeFromDB,
};
