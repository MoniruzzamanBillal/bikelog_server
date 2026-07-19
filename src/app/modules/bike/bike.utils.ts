import httpStatus from "http-status";
import { bikeModel, TBikeDocument } from "./bike.model";
import AppError from "../../Error/AppError";

export const findOwnedBikeOrThrow = async (bikeId: string, userId: string) => {
  const bike = await bikeModel.findOne({
    _id: bikeId,
    owner: userId,
    isDeleted: false,
  });
  if (!bike) throw new AppError(httpStatus.NOT_FOUND, "Bike not found");
  return bike;
};

export const bumpOdometerIfHigher = async (bike: TBikeDocument, newReading: number) => {
  if (newReading > bike.currentOdometer) {
    bike.currentOdometer = newReading;
    await bike.save();
  }
};