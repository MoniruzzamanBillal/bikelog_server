import { Prisma } from "@prisma/client";
import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import { prisma } from "../../lib/prisma";
import { generateObjectId } from "../../util/generateObjectId";
import { TMaintenanceType } from "./maintenanceType.interface";
import { findOwnedMaintenanceTypeOrThrow } from "./maintenanceType.utils";

// ! Spec 46: this catalog is per-user, not global. Every query below must carry BOTH
// ! `ownerId` and `isDeleted: false` — Prisma has no query hook to add either for us.
// ! `ownerId` is never read from the request body (it is deliberately absent from the Zod
// ! schemas and from TMaintenanceType); it always comes from the verified JWT.

const createMaintenanceTypeIntoDB = async (
  userId: string,
  payload: Partial<TMaintenanceType>,
) => {
  // ! Spec 41 §F, re-scoped by spec 46 §B: the unique is now `(ownerId, name)` and still
  // ! covers soft-deleted rows, so re-adding a name THIS USER deleted would otherwise hit
  // ! P2002 and claim it "already exists" about a row they can no longer see. Revive their
  // ! row instead of inserting a second one — keeping the original id means their
  // ! historical maintenance logs stay correctly labelled. Another user's row with the
  // ! same name is a different row with a different id and is never consulted.
  const softDeleted = await prisma.maintenanceType.findFirst({
    where: { ownerId: userId, name: payload.name as string, isDeleted: true },
  });

  if (softDeleted) {
    const revived = await prisma.maintenanceType.update({
      where: { id: softDeleted.id },
      data: {
        isDeleted: false,
        defaultIntervalKm: payload.defaultIntervalKm,
        defaultIntervalDays: payload.defaultIntervalDays,
        requiresOilType: payload.requiresOilType,
      },
    });
    return { ...revived, _id: revived.id };
  }

  try {
    const result = await prisma.maintenanceType.create({
      data: {
        id: generateObjectId(),
        ownerId: userId,
        name: payload.name as string,
        defaultIntervalKm: payload.defaultIntervalKm,
        defaultIntervalDays: payload.defaultIntervalDays,
        requiresOilType: payload.requiresOilType,
      },
    });
    return { ...result, _id: result.id };
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      // ! Message unchanged from spec 06 on purpose — it now fires on `(ownerId, name)`,
      // ! which finally makes it TRUE from the user's point of view. Before spec 46 it
      // ! could fire because a different user happened to own that name.
      throw new AppError(
        httpStatus.CONFLICT,
        "A maintenance type with this name already exists",
      );
    }
    throw error;
  }
};

const getMaintenanceTypesFromDB = async (userId: string) => {
  const result = await prisma.maintenanceType.findMany({
    where: { ownerId: userId, isDeleted: false },
    orderBy: { name: "asc" },
  });
  // ! An empty array is a legitimate response, not an error: spec 46 decision 2 gives new
  // ! users empty catalogs and there is no seeding (spec 42 removed the seed scripts).
  return result.map((item) => ({ ...item, _id: item.id }));
};

const updateMaintenanceTypeInDB = async (
  userId: string,
  id: string,
  payload: Partial<TMaintenanceType>,
) => {
  // ! Spec 41 §G + spec 46 §D/§E: one lookup covers all three refusals — unknown id,
  // ! soft-deleted row, and another user's row — all as a 404.
  await findOwnedMaintenanceTypeOrThrow(id, userId);

  try {
    const result = await prisma.maintenanceType.update({
      where: { id },
      data: {
        name: payload.name,
        defaultIntervalKm: payload.defaultIntervalKm,
        defaultIntervalDays: payload.defaultIntervalDays,
        requiresOilType: payload.requiresOilType,
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
        "A maintenance type with this name already exists",
      );
    }
    throw error;
  }
};

const deleteMaintenanceTypeFromDB = async (userId: string, id: string) => {
  const existing = await findOwnedMaintenanceTypeOrThrow(id, userId);

  // ! Spec 41 §E / decision 2: only LIVE logs block a delete. A soft-deleted log does not —
  // ! otherwise a type used even once could never be removed. Safe either way, since the
  // ! catalog row is never actually removed, so the FK stays valid regardless.
  // ! This count must run BEFORE the update: globalErrorHandler has no P2003 branch, so an
  // ! unguarded FK violation would reach the client as a generic 500.
  // ! Spec 46 §D: the count stays scoped on `maintenanceTypeId` alone and deliberately
  // ! does NOT join through to the bike's owner. `id` has just been proven to belong to
  // ! `userId`, so every log that can match is necessarily this user's — an owner join
  // ! here would be redundant, not a hardening. Don't add one.
  const inUse = await prisma.maintenanceLog.count({
    where: { maintenanceTypeId: id, isDeleted: false },
  });

  if (inUse > 0) {
    // ! User-facing copy — the clients show this verbatim in a warning toast, so it names
    // ! the type, gives the count, and says what to do next. Byte-identical to pre-spec-46.
    throw new AppError(
      httpStatus.CONFLICT,
      `"${existing.name}" is used by ${inUse} maintenance log${
        inUse === 1 ? "" : "s"
      } and can't be deleted. Remove or re-assign ${
        inUse === 1 ? "it" : "them"
      } first.`,
    );
  }

  const result = await prisma.maintenanceType.update({
    where: { id },
    data: { isDeleted: true },
  });
  return { ...result, _id: result.id };
};

export const maintenanceTypeServices = {
  createMaintenanceTypeIntoDB,
  getMaintenanceTypesFromDB,
  updateMaintenanceTypeInDB,
  deleteMaintenanceTypeFromDB,
};
