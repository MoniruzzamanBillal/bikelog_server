import { ObjectId } from "mongoose";
import { TCloudinaryFile } from "../../interface/image.interface";

export type TBikeDocumentFile = TCloudinaryFile & { _id?: ObjectId };

export type TBikeDocument = {
  bike: ObjectId;
  title: string;
  description?: string;
  expiryDate?: Date;
  files?: TBikeDocumentFile[];
  isDeleted: boolean;
};
