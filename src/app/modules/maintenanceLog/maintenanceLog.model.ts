import { model, Schema, ObjectId } from "mongoose";
import { TCloudinaryImage } from "../../interface/image.interface";

// Full Mongoose-document shape, kept separate from the Prisma-era
// `TMaintenanceLog` (create-payload only, see maintenanceLog.interface.ts)
// since this model must keep compiling until Phase 7 rewrites
// spending.service.ts/ai.service.ts's still-Mongo direct imports.
type TMaintenanceLogFields = {
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

const maintenanceLogSchema = new Schema<TMaintenanceLogFields>(
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
export const maintenanceLogModel = model<TMaintenanceLogFields>(
  "MaintenanceLog",
  maintenanceLogSchema,
);
