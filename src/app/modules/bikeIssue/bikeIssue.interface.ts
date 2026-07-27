import { ObjectId } from "mongoose";
import { TBikeIssueStatus } from "./bikeIssue.constant";
import { TCloudinaryImage } from "../../interface/image.interface";

export type TBikeIssueImage = TCloudinaryImage & { _id?: ObjectId };

export type TBikeIssue = {
  bike: ObjectId;
  title: string;
  description?: string;
  dateReported: Date;
  status: TBikeIssueStatus;
  images?: TBikeIssueImage[];
  isDeleted: boolean;
};
