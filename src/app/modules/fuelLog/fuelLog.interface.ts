import { ObjectId } from "mongoose";

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
  isDeleted: boolean;
};
