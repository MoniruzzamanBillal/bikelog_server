import { model, Schema } from "mongoose";
import { TMaintenanceLog } from "./maintenanceLog.interface";

const maintenanceLogSchema = new Schema<TMaintenanceLog>(
  {
    bike: {
      type: Schema.Types.ObjectId,
      ref: "Bike",
      required: [true, "bike is required "],
    },
    maintenanceType: {
      type: Schema.Types.ObjectId,
      ref: "MaintenanceType",
      required: [true, "maintenance type is required "],
    },
    odometerReading: {
      type: Number,
      required: [true, "odometer reading is required "],
    },
    oilType: {
      type: Schema.Types.ObjectId,
      ref: "EngineOilType",
    },
    intervalKmUsed: {
      type: Number,
    },
    nextDueOdometer: {
      type: Number,
    },
    nextDueDate: {
      type: Date,
    },
    cost: {
      type: Number,
      required: [true, "cost is required "],
    },
    serviceDate: {
      type: Date,
      required: [true, "service date is required "],
      default: Date.now,
    },
    serviceCenter: {
      type: String,
    },
    partsReplaced: [
      {
        type: String,
      },
    ],
    notes: {
      type: String,
    },
    serviceImage: {
      type: {
        url: { type: String },
        publicId: { type: String },
      },
      _id: false,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

// ! filter out soft-deleted maintenance logs
maintenanceLogSchema.pre("find", async function (next) {
  this.where({ isDeleted: false });
  next();
});

maintenanceLogSchema.pre("findOne", async function (next) {
  this.where({ isDeleted: false });
  next();
});

//
export const maintenanceLogModel = model<TMaintenanceLog>(
  "MaintenanceLog",
  maintenanceLogSchema,
);
