import { ObjectId } from "mongoose";
import { TBikeIssueStatus } from "./bikeIssue.constant";

export type TBikeIssueHistoryEntry = {
  resolvedAt: Date;
  reopenedAt?: Date;
  resolvedInMaintenanceLog?: ObjectId;
};

export type TBikeIssue = {
  bike: ObjectId;
  title: string;
  description?: string;
  dateReported: Date;
  status: TBikeIssueStatus;
  history: TBikeIssueHistoryEntry[];
  isDeleted: boolean;
};
