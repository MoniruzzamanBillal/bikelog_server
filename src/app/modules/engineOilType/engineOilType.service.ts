import { Prisma } from "@prisma/client";
import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import { prisma } from "../../lib/prisma";
import { generateObjectId } from "../../util/generateObjectId";
import { TEngineOilType } from "./engineOilType.interface";

const createEngineOilTypeIntoDB = async (
  payload: Partial<TEngineOilType>,
) => {
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
    orderBy: { name: "asc" },
  });
  return result.map((item) => ({ ...item, _id: item.id }));
};

const updateEngineOilTypeInDB = async (
  id: string,
  payload: Partial<TEngineOilType>,
) => {
  const existing = await prisma.engineOilType.findUnique({ where: { id } });
  if (!existing) {
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

export const engineOilTypeServices = {
  createEngineOilTypeIntoDB,
  getEngineOilTypesFromDB,
  updateEngineOilTypeInDB,
};
