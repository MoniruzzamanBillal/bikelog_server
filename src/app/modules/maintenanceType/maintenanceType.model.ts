import { model, Schema } from "mongoose";
import { TMaintenanceType } from "./maintenanceType.interface";

// ! no soft delete — small shared/seeded catalog, not user-owned data
const maintenanceTypeSchema = new Schema<TMaintenanceType>(
  {
    name: {
      type: String,
      required: [true, "maintenance type name is required "],
      unique: true,
    },
    defaultIntervalKm: {
      type: Number,
      default: null,
    },
    defaultIntervalDays: {
      type: Number,
      default: null,
    },
  },
  { timestamps: true },
);

//
export const maintenanceTypeModel = model<TMaintenanceType>(
  "MaintenanceType",
  maintenanceTypeSchema,
);
