import { ObjectId } from "mongoose";
import { TAccessoryStatus, TAccessoryUrgency } from "./bikeAccessory.constant";
import { TCloudinaryImage } from "../../interface/image.interface";

export type TBikeAccessory = {
  bike: ObjectId;
  name: string;
  urgency: TAccessoryUrgency;
  status: TAccessoryStatus;
  price?: number;
  productImage?: TCloudinaryImage;
  isDeleted: boolean;
};
