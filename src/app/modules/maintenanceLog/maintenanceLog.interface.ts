import { ObjectId } from "mongoose";

export type TMaintenanceLog = {
  bike: ObjectId;
  maintenanceType: ObjectId;
  odometerReading: number;
  oilType?: ObjectId;
  intervalKmUsed: number;
  nextDueOdometer: number;
  nextDueDate?: Date;
  cost: number;
  serviceDate: Date;
  serviceCenter?: string;
  partsReplaced?: string[];
  notes?: string;
  isDeleted: boolean;
};
