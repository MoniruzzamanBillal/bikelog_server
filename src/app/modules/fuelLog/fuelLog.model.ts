import { model, Schema } from "mongoose";
import { TFuelLog } from "./fuelLog.interface";

const fuelLogSchema = new Schema<TFuelLog>(
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
export const fuelLogModel = model<TFuelLog>("FuelLog", fuelLogSchema);
