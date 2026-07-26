import { ObjectId } from "mongoose";

export type TBike = {
  owner: ObjectId;
  nickname: string;
  brand: string;
  model: string;
  registrationNumber: string;
  purchaseDate: Date;
  fuelTankCapacityLiters: number;
  currentOdometer: number;
  initialOdometer: number;
  isDeleted: boolean;
  aiSpendingInsight?: string;
  aiSpendingInsightLogCount?: number;
  aiMileageInsight?: string;
  aiMileageInsightFuelLogCount?: number;
  createdAt: Date;
  updatedAt: Date;
};
