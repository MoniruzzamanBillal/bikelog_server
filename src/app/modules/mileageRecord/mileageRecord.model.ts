import { model, Schema, ObjectId } from "mongoose";

// Full Mongoose-document shape, kept separate from the Prisma-era
// `TMileageRecord` (see mileageRecord.interface.ts). Nothing imports
// mileageRecordModel outside this file after this phase's rewrite, but the
// file itself must still compile independently (tsc builds every file under
// src/, not just imported ones) — kept in place per spec 33's explicit
// "do not delete" instruction rather than removed as dead code.
type TMileageRecordFields = {
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

// ! no soft delete here — MileageRecord is derived/auto-generated from FuelLog closures, not directly user-managed
const mileageRecordSchema = new Schema<TMileageRecordFields>(
  {
    bike: {
      type: Schema.Types.ObjectId,
      ref: "Bike",
      required: [true, "bike is required "],
    },
    startOdometer: {
      type: Number,
      required: [true, "start odometer is required "],
    },
    endOdometer: {
      type: Number,
      required: [true, "end odometer is required "],
    },
    distanceKm: {
      type: Number,
      required: [true, "distance is required "],
    },
    litersConsumed: {
      type: Number,
      required: [true, "liters consumed is required "],
    },
    mileageKmPerLiter: {
      type: Number,
      required: [true, "mileage is required "],
    },
    periodStartDate: {
      type: Date,
      required: [true, "period start date is required "],
    },
    periodEndDate: {
      type: Date,
      required: [true, "period end date is required "],
    },
    fuelLogIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "FuelLog",
      },
    ],
  },
  { timestamps: true },
);

//
export const mileageRecordModel = model<TMileageRecordFields>(
  "MileageRecord",
  mileageRecordSchema,
);
