import { ObjectId } from "mongoose";
import { TCloudinaryImage } from "../../interface/image.interface";

export type TFuelLog = {
  bike: ObjectId;
  odometerReading: number;
  litersAdded: number;
  isFullTank: boolean;
  pricePerLiter: number;
  totalCost: number;
  fuelStation?: string;
  date: Date;
  notes?: string;
  receiptImage?: TCloudinaryImage;
  isDeleted: boolean;
};
