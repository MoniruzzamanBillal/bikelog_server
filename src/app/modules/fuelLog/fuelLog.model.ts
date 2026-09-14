import { model, Schema, ObjectId } from "mongoose";
import { TCloudinaryImage } from "../../interface/image.interface";

// Full Mongoose-document shape, kept separate from the Prisma-era `TFuelLog`
// (create-payload only, see fuelLog.interface.ts) since this model must keep
// compiling until Phase 7 rewrites spending.service.ts/ai.service.ts's still-
// Mongo direct imports of fuelLogModel.
type TFuelLogFields = {
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

const fuelLogSchema = new Schema<TFuelLogFields>(
  {
    bike: {
      type: Schema.Types.ObjectId,
      ref: "Bike",
      required: [true, "bike is required "],
    },
    odometerReading: {
      type: Number,
      required: [true, "odometer reading is required "],
    },
    litersAdded: {
      type: Number,
      required: [true, "liters added is required "],
    },
    isFullTank: {
      type: Boolean,
      required: [true, "isFullTank flag is required "],
    },
    pricePerLiter: {
      type: Number,
      required: [true, "price per liter is required "],
    },
    totalCost: {
      type: Number,
      required: [true, "total cost is required "],
    },
    fuelStation: {
      type: String,
    },
    date: {
      type: Date,
      required: [true, "date is required "],
      default: Date.now,
    },
    notes: {
      type: String,
    },
    receiptImage: {
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

// ! filter out soft-deleted fuel logs
fuelLogSchema.pre("find", async function (next) {
  this.where({ isDeleted: false });
  next();
});

fuelLogSchema.pre("findOne", async function (next) {
  this.where({ isDeleted: false });
  next();
});

//
export const fuelLogModel = model<TFuelLogFields>("FuelLog", fuelLogSchema);
