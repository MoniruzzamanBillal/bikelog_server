import { model, Schema } from "mongoose";
import { TEngineOilType } from "./engineOilType.interface";

// ! no soft delete — small shared reference table, only used to pre-fill the Engine Oil form
const engineOilTypeSchema = new Schema<TEngineOilType>(
  {
    name: {
      type: String,
      required: [true, "engine oil type name is required "],
      unique: true,
    },
    suggestedIntervalKm: {
      type: Number,
      required: [true, "suggested interval is required "],
    },
  },
  { timestamps: true },
);

//
export const engineOilTypeModel = model<TEngineOilType>(
  "EngineOilType",
  engineOilTypeSchema,
);
