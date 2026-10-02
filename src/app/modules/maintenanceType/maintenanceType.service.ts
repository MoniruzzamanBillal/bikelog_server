import { Prisma } from "@prisma/client";
import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import { prisma } from "../../lib/prisma";
import { generateObjectId } from "../../util/generateObjectId";
import { TMaintenanceType } from "./maintenanceType.interface";

const createMaintenanceTypeIntoDB = async (
  payload: Partial<TMaintenanceType>,
) => {
  // ! Spec 41 §F: `name` is @unique, so re-adding a soft-deleted name would otherwise hit
  // ! P2002 and tell the user it "already exists" about a row they can no longer see.
  // ! Revive that row instead of inserting a second one — keeping the original id means
  // ! historical maintenance logs referencing it stay correctly labelled.
  const softDeleted = await prisma.maintenanceType.findFirst({
    where: { name: payload.name as string, isDeleted: true },
  });

  if (softDeleted) {
    const revived = await prisma.maintenanceType.update({
      where: { id: softDeleted.id },
      data: {
        isDeleted: false,
        defaultIntervalKm: payload.defaultIntervalKm,
        defaultIntervalDays: payload.defaultIntervalDays,
      },
    });
    return { ...revived, _id: revived.id };
  }

  try {
    const result = await prisma.maintenanceType.create({
      data: {
        id: generateObjectId(),
        name: payload.name as string,
        defaultIntervalKm: payload.defaultIntervalKm,
        defaultIntervalDays: payload.defaultIntervalDays,
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

const getMaintenanceTypesFromDB = async () => {
  const result = await prisma.maintenanceType.findMany({
    where: { isDeleted: false },
    orderBy: { name: "asc" },
  });
  return result.map((item) => ({ ...item, _id: item.id }));
};

const updateMaintenanceTypeInDB = async (
  id: string,
  payload: Partial<TMaintenanceType>,
) => {
  const existing = await prisma.maintenanceType.findUnique({ where: { id } });
  // ! Spec 41 §G: a soft-deleted row is invisible to the client, so it must 404 rather
  // ! than silently accept an edit.
  if (!existing || existing.isDeleted) {
    throw new AppError(httpStatus.NOT_FOUND, "Maintenance type not found");
  }

  try {
    const result = await prisma.maintenanceType.update({
      where: { id },
      data: {
        name: payload.name,
        defaultIntervalKm: payload.defaultIntervalKm,
        defaultIntervalDays: payload.defaultIntervalDays,
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

const deleteMaintenanceTypeFromDB = async (id: string) => {
  const existing = await prisma.maintenanceType.findUnique({ where: { id } });
  if (!existing || existing.isDeleted) {
    throw new AppError(httpStatus.NOT_FOUND, "Maintenance type not found");
  }

  // ! Spec 41 §E / decision 2: only LIVE logs block a delete. A soft-deleted log does not —
  // ! otherwise a type used even once could never be removed. Safe either way, since the
  // ! catalog row is never actually removed, so the FK stays valid regardless.
  // ! This count must run BEFORE the update: globalErrorHandler has no P2003 branch, so an
  // ! unguarded FK violation would reach the client as a generic 500.
  const inUse = await prisma.maintenanceLog.count({
    where: { maintenanceTypeId: id, isDeleted: false },
  });

  if (inUse > 0) {
    // ! User-facing copy — the clients show this verbatim in a warning toast, so it names
    // ! the type, gives the count, and says what to do next.
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
