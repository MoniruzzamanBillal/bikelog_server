export type TBikeManualMeta = {
  url: string;
  publicId: string;
  originalName: string;
  uploadedAt: Date;
  chunkCount: number;
};

// ! never reaches an HTTP response (only scored/ranked in-process for an AI prompt, see
// ! bikeManual.utils.ts) — no _id/bike remap needed, bike is dropped here as it's never
// ! read off a chunk object anywhere
export type TBikeManualChunk = {
  chunkIndex: number;
  chunkText: string;
};
