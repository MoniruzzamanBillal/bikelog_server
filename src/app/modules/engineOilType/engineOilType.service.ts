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

export const engineOilTypeServices = {
  createEngineOilTypeIntoDB,
  getEngineOilTypesFromDB,
};
