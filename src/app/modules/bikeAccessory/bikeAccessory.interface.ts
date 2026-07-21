import { ObjectId } from "mongoose";
import { TAccessoryStatus, TAccessoryUrgency } from "./bikeAccessory.constant";

export type TBikeAccessory = {
  bike: ObjectId;
  name: string;
  urgency: TAccessoryUrgency;
  status: TAccessoryStatus;
  isDeleted: boolean;
};
