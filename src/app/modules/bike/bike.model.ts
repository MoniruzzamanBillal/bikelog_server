import { model, Schema, Document } from "mongoose";
import { TBike } from "./bike.interface";

export type TBikeDocument = TBike & Document;

const bikeSchema = new Schema(
  {
    owner: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "owner is required "],
    },
    nickname: {
      type: String,
      required: [true, "bike nickname is required "],
    },
    brand: {
      type: String,
      required: [true, "bike brand is required "],
    },
    model: {
      type: String,
      required: [true, "bike model is required "],
    },
    registrationNumber: {
      type: String,
      required: [true, "registration number is required "],
    },
    purchaseDate: {
      type: Date,
      required: [true, "purchase date is required "],
    },
    fuelTankCapacityLiters: {
      type: Number,
      required: [true, "fuel tank capacity is required "],
    },
    currentOdometer: {
      type: Number,
      required: [true, "current odometer reading is required "],
      default: 0,
    },
    // ! immutable snapshot of currentOdometer at creation time — currentOdometer gets bumped by
    // ! every later fuel/maintenance log, so this is the only stable anchor for "since the start" math
    initialOdometer: {
      type: Number,
      required: [true, "initial odometer reading is required "],
      default: 0,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

// ! filter out soft-deleted bikes
bikeSchema.pre("find", async function (next) {
  this.where({ isDeleted: false });
  next();
});

bikeSchema.pre("findOne", async function (next) {
  this.where({ isDeleted: false });
  next();
});

//
export const bikeModel = model<TBikeDocument>("Bike", bikeSchema);
