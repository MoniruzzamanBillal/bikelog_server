import { ObjectId } from "mongoose";

export type TMileageRecord = {
  bike: ObjectId;
  startOdometer: number;
  endOdometer: number;
  distanceKm: number;
  litersConsumed: number;
  mileageKmPerLiter: number;
  periodStartDate: Date;
  periodEndDate: Date;
  fuelLogIds: ObjectId[];
};
