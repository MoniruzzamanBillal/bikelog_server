import { Prisma } from "@prisma/client";
import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import { prisma } from "../../lib/prisma";
import { generateObjectId } from "../../util/generateObjectId";
import { TEngineOilType } from "./engineOilType.interface";

const createEngineOilTypeIntoDB = async (
  payload: Partial<TEngineOilType>,
) => {
  // ! Spec 41 §I/§F: `name` is @unique, so re-adding a soft-deleted name would otherwise
  // ! hit P2002 and claim it "already exists" about a row the user can no longer see.
  // ! Revive that row, preserving its id so historical logs stay correctly labelled.
  const softDeleted = await prisma.engineOilType.findFirst({
    where: { name: payload.name as string, isDeleted: true },
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
      throw new AppError(
        httpStatus.CONFLICT,
        "An engine oil type with this name already exists",
      );
    }
    throw error;
  }
};

const getEngineOilTypesFromDB = async () => {
  const result = await prisma.engineOilType.findMany({
    where: { isDeleted: false },
    orderBy: { name: "asc" },
  });
  return result.map((item) => ({ ...item, _id: item.id }));
};

const updateEngineOilTypeInDB = async (
  id: string,
  payload: Partial<TEngineOilType>,
) => {
  const existing = await prisma.engineOilType.findUnique({ where: { id } });
  // ! Spec 41 §G: a soft-deleted row is invisible to the client, so it must 404 rather
  // ! than silently accept an edit.
  if (!existing || existing.isDeleted) {
    throw new AppError(httpStatus.NOT_FOUND, "Engine oil type not found");
  }

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

const deleteEngineOilTypeFromDB = async (id: string) => {
  const existing = await prisma.engineOilType.findUnique({ where: { id } });
  if (!existing || existing.isDeleted) {
    throw new AppError(httpStatus.NOT_FOUND, "Engine oil type not found");
  }

  // ! Spec 41 §I / decision 2: same rule as the maintenance catalog — only LIVE logs block.
  // ! MaintenanceLog.oilTypeId is nullable (String?), so a log that recorded no oil type
  // ! simply never matches here; `count` handles that for free, no null-guard needed.
  // ! Runs BEFORE the update: globalErrorHandler has no P2003 branch, so an unguarded FK
  // ! violation would reach the client as a generic 500.
  const inUse = await prisma.maintenanceLog.count({
    where: { oilTypeId: id, isDeleted: false },
  });

  if (inUse > 0) {
    // ! User-facing copy — shown verbatim in the clients' warning toast.
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
