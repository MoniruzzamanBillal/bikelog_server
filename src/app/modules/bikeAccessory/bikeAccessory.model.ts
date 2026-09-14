import { model, Schema, ObjectId } from "mongoose";
import {
  AccessoryStatus,
  AccessoryUrgency,
  TAccessoryStatus,
  TAccessoryUrgency,
} from "./bikeAccessory.constant";
import { TCloudinaryImage } from "../../interface/image.interface";

// Full Mongoose-document shape, kept separate from the Prisma-era
// `TBikeAccessory` (create-payload only, see bikeAccessory.interface.ts)
// since this model must keep compiling until Phase 7 rewrites
// spending.service.ts's still-Mongo direct import.
type TBikeAccessoryFields = {
  bike: ObjectId;
  name: string;
  urgency: TAccessoryUrgency;
  status: TAccessoryStatus;
  price?: number;
  purchaseDate?: Date;
  productImage?: TCloudinaryImage;
  isDeleted: boolean;
};

const bikeAccessorySchema = new Schema<TBikeAccessoryFields>(
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
    price: {
      type: Number,
    },
    // ! set server-side only, the moment status transitions into "purchased" — never client-supplied
    purchaseDate: {
      type: Date,
    },
    productImage: {
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
export const bikeAccessoryModel = model<TBikeAccessoryFields>(
  "BikeAccessory",
  bikeAccessorySchema,
);
