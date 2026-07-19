import { TMaintenanceType } from "./maintenanceType.interface";
import { maintenanceTypeModel } from "./maintenanceType.model";
import httpStatus from "http-status";
import AppError from "../../Error/AppError";

const createMaintenanceTypeIntoDB = async (payload: Partial<TMaintenanceType>) => {
  try {
    const result = await maintenanceTypeModel.create(payload);
    return result;
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && (error as { code: number }).code === 11000) {
      throw new AppError(
        httpStatus.CONFLICT,
        "A maintenance type with this name already exists",
      );
    }
    throw error;
  }
};

const getMaintenanceTypesFromDB = async () => {
  const result = await maintenanceTypeModel.find().sort({ name: 1 });
  return result;
};

export const maintenanceTypeServices = {
  createMaintenanceTypeIntoDB,
  getMaintenanceTypesFromDB,
};