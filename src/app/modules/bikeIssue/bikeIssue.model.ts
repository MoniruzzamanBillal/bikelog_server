import { model, Schema } from "mongoose";
import { BikeIssueStatus } from "./bikeIssue.constant";
import { TBikeIssue } from "./bikeIssue.interface";

const bikeIssueSchema = new Schema<TBikeIssue>(
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
    dateReported: {
      type: Date,
      required: [true, "dateReported is required "],
      default: Date.now,
    },
    status: {
      type: String,
      enum: Object.values(BikeIssueStatus),
      default: BikeIssueStatus.open,
    },
    statusRank: {
      type: Number,
      default: 0,
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

// ! keep statusRank in sync with status so the list endpoint can sort open-before-resolved
// ! at the DB-query level (see context/specs/12-bike-issue-list-sort-order.md)
bikeIssueSchema.pre("save", function (next) {
  this.statusRank = Object.values(BikeIssueStatus).indexOf(this.status);
  next();
});

// ! filter out soft-deleted bike issues
bikeIssueSchema.pre("find", async function (next) {
  this.where({ isDeleted: false });
  next();
});

bikeIssueSchema.pre("findOne", async function (next) {
  this.where({ isDeleted: false });
  next();
});

//
export const bikeIssueModel = model<TBikeIssue>("BikeIssue", bikeIssueSchema);
