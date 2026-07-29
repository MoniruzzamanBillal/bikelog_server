import { model, Schema } from "mongoose";
import { TBikeDocument } from "./bikeDocument.interface";

const bikeDocumentSchema = new Schema<TBikeDocument>(
  {
    bike: {
      type: Schema.Types.ObjectId,
      ref: "Bike",
      required: [true, "bike is required "],
    },
    title: {
      type: String,
      required: [true, "title is required "],
    },
    description: {
      type: String,
    },
    expiryDate: {
      type: Date,
    },
    files: [
      {
        url: { type: String },
        publicId: { type: String },
        resourceType: { type: String, enum: ["image", "raw"] },
        originalName: { type: String },
        mimeType: { type: String },
      },
    ],
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

// ! filter out soft-deleted bike documents
bikeDocumentSchema.pre("find", async function (next) {
  this.where({ isDeleted: false });
  next();
});

bikeDocumentSchema.pre("findOne", async function (next) {
  this.where({ isDeleted: false });
  next();
});

//
export const bikeDocumentModel = model<TBikeDocument>(
  "BikeDocument",
  bikeDocumentSchema,
);
