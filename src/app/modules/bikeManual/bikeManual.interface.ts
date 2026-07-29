import { ObjectId } from "mongoose";

export type TBikeManualMeta = {
  url: string;
  publicId: string;
  originalName: string;
  uploadedAt: Date;
  chunkCount: number;
};

export type TBikeManualChunk = {
  bike: ObjectId;
  chunkIndex: number;
  chunkText: string;
};
