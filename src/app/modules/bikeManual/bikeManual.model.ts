import { model, Schema } from "mongoose";
import { TBikeManualChunk } from "./bikeManual.interface";

// ! derived data (regenerated whenever the manual is replaced/removed) — no soft delete,
// ! no pre-find hooks, same convention as mileageRecord
const bikeManualChunkSchema = new Schema<TBikeManualChunk>(
  {
    bike: {
      type: Schema.Types.ObjectId,
      ref: "Bike",
      required: [true, "bike is required "],
      index: true,
    },
    chunkIndex: {
      type: Number,
      required: [true, "chunkIndex is required "],
    },
    chunkText: {
      type: String,
      required: [true, "chunkText is required "],
    },
  },
  { timestamps: true },
);

//
export const bikeManualChunkModel = model<TBikeManualChunk>(
  "BikeManualChunk",
  bikeManualChunkSchema,
);
