import { Prisma } from "@prisma/client";
import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import { prisma } from "../../lib/prisma";
import { generateObjectId } from "../../util/generateObjectId";
import { TMaintenanceType } from "./maintenanceType.interface";

const createMaintenanceTypeIntoDB = async (
  payload: Partial<TMaintenanceType>,
) => {
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
    orderBy: { name: "asc" },
  });
  return result.map((item) => ({ ...item, _id: item.id }));
};

const updateMaintenanceTypeInDB = async (
  id: string,
  payload: Partial<TMaintenanceType>,
) => {
  const existing = await prisma.maintenanceType.findUnique({ where: { id } });
  if (!existing) {
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

export const maintenanceTypeServices = {
  createMaintenanceTypeIntoDB,
  getMaintenanceTypesFromDB,
  updateMaintenanceTypeInDB,
};
