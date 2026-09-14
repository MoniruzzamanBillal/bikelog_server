import { model, Schema, Document } from "mongoose";
import { TBikeManualMeta } from "../bikeManual/bikeManual.interface";

// Full Mongoose-document shape, kept separate from the Prisma-era `TBike`
// (create-payload only, see bike.interface.ts) since this model must keep
// compiling until Phase 7 rewrites ai.service.ts/notification.service.ts's
// direct imports.
type TBikeFields = {
  owner: string;
  nickname: string;
  brand: string;
  model: string;
  registrationNumber: string;
  purchaseDate: Date;
  fuelTankCapacityLiters: number;
  currentOdometer: number;
  initialOdometer: number;
  isDeleted: boolean;
  aiSpendingInsight?: string;
  aiSpendingInsightLogCount?: number;
  aiMileageInsight?: string;
  aiMileageInsightFuelLogCount?: number;
  manual?: TBikeManualMeta;
  createdAt: Date;
  updatedAt: Date;
};

export type TBikeDocument = TBikeFields & Document;

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
    // ! count-based AI-insight cache: regenerate only when the underlying log count changes,
    // ! not on a TTL — cheaper and avoids staleness between fixed intervals
    aiSpendingInsight: {
      type: String,
    },
    aiSpendingInsightLogCount: {
      type: Number,
    },
    aiMileageInsight: {
      type: String,
    },
    aiMileageInsightFuelLogCount: {
      type: Number,
    },
    // ! additive/optional — a bike with no manual uploaded simply omits this field
    manual: {
      type: {
        url: { type: String },
        publicId: { type: String },
        originalName: { type: String },
        uploadedAt: { type: Date },
        chunkCount: { type: Number },
      },
      _id: false,
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
