import { model, Schema } from "mongoose";
import { AccessoryStatus, AccessoryUrgency } from "./bikeAccessory.constant";
import { TBikeAccessory } from "./bikeAccessory.interface";

const bikeAccessorySchema = new Schema<TBikeAccessory>(
  {
    bike: {
      type: Schema.Types.ObjectId,
      ref: "Bike",
      required: [true, "bike is required "],
    },
    name: {
      type: String,
      required: [true, "name is required "],
    },
    urgency: {
      type: String,
      enum: Object.values(AccessoryUrgency),
      required: [true, "urgency is required "],
    },
    status: {
      type: String,
      enum: Object.values(AccessoryStatus),
      default: AccessoryStatus.pending,
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

// ! filter out soft-deleted bike accessories
bikeAccessorySchema.pre("find", async function (next) {
  this.where({ isDeleted: false });
  next();
});

bikeAccessorySchema.pre("findOne", async function (next) {
  this.where({ isDeleted: false });
  next();
});

//
export const bikeAccessoryModel = model<TBikeAccessory>(
  "BikeAccessory",
  bikeAccessorySchema,
);
