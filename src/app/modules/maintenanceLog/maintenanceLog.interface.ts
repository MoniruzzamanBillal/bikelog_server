import { ObjectId } from "mongoose";
import { TCloudinaryImage } from "../../interface/image.interface";

export type TMaintenanceLog = {
  bike: ObjectId;
  maintenanceType: ObjectId;
  odometerReading: number;
  oilType?: ObjectId;
  intervalKmUsed?: number;
  nextDueOdometer?: number;
  nextDueDate?: Date;
  cost: number;
  serviceDate: Date;
  serviceCenter?: string;
  partsReplaced?: string[];
  notes?: string;
  serviceImage?: TCloudinaryImage;
  isDeleted: boolean;
};
