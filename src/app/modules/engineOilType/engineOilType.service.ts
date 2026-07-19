import { TEngineOilType } from "./engineOilType.interface";
import { engineOilTypeModel } from "./engineOilType.model";
import httpStatus from "http-status";
import AppError from "../../Error/AppError";

const createEngineOilTypeIntoDB = async (payload: Partial<TEngineOilType>) => {
  try {
    const result = await engineOilTypeModel.create(payload);
    return result;
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && (error as { code: number }).code === 11000) {
      throw new AppError(
        httpStatus.CONFLICT,
        "An engine oil type with this name already exists",
      );
    }
    throw error;
  }
};

const getEngineOilTypesFromDB = async () => {
  const result = await engineOilTypeModel.find().sort({ name: 1 });
  return result;
};

export const engineOilTypeServices = {
  createEngineOilTypeIntoDB,
  getEngineOilTypesFromDB,
};