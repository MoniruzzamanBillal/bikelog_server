import { ObjectId } from "mongoose";
import { TBikeIssueStatus } from "./bikeIssue.constant";

export type TBikeIssue = {
  bike: ObjectId;
  title: string;
  description?: string;
  dateReported: Date;
  status: TBikeIssueStatus;
  isDeleted: boolean;
};
