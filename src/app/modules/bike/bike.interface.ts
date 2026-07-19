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
  createdAt: Date;
  updatedAt: Date;
};
