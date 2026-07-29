import httpStatus from "http-status";
import pdfParse from "pdf-parse";
import AppError from "../../Error/AppError";
import { findOwnedBikeOrThrow } from "../bike/bike.utils";
import { deleteCloudinaryImage, uploadRawBuffer } from "../../util/cloudinary";
import { bikeManualChunkModel } from "./bikeManual.model";
import { chunkManualText, scoreAndRankChunks } from "./bikeManual.utils";

const uploadBikeManualIntoDB = async (
  bikeId: string,
  userId: string,
  file: Express.Multer.File | undefined,
) => {
  const bike = await findOwnedBikeOrThrow(bikeId, userId);

  if (!file) {
    throw new AppError(httpStatus.BAD_REQUEST, "A PDF manual file is required");
  }

  // ! extract before touching Cloudinary/DB so a bad upload fails with zero side effects
  const { text } = await pdfParse(file.buffer);

  if (!text || text.trim().length === 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Could not extract text from this PDF",
    );
  }

  const chunkTexts = chunkManualText(text);

  // ! replace case — delete old asset + chunks before uploading/inserting the new ones
  if (bike.manual) {
    await deleteCloudinaryImage(bike.manual.publicId, "raw");
    await bikeManualChunkModel.deleteMany({ bike: bikeId });
  }

  const { url, publicId } = await uploadRawBuffer(file.buffer, file.originalname);

  await bikeManualChunkModel.insertMany(
    chunkTexts.map((chunkText, chunkIndex) => ({
      bike: bikeId,
      chunkIndex,
      chunkText,
    })),
  );

  bike.manual = {
    url,
    publicId,
    originalName: file.originalname,
    uploadedAt: new Date(),
    chunkCount: chunkTexts.length,
  };
  await bike.save();

  return bike.manual;
};

const getBikeManualMetaFromDB = async (bikeId: string, userId: string) => {
  const bike = await findOwnedBikeOrThrow(bikeId, userId);

  if (!bike.manual) {
    return { hasManual: false, manual: null };
  }

  return { hasManual: true, manual: bike.manual };
};

const deleteBikeManualFromDB = async (bikeId: string, userId: string) => {
  const bike = await findOwnedBikeOrThrow(bikeId, userId);

  if (!bike.manual) {
    throw new AppError(httpStatus.NOT_FOUND, "This bike has no manual uploaded");
  }

  await deleteCloudinaryImage(bike.manual.publicId, "raw");
  await bikeManualChunkModel.deleteMany({ bike: bikeId });

  bike.manual = undefined;
  await bike.save();

  return null;
};

// ! the only function ai.service.ts imports from this module
const getRelevantManualChunksForChat = async (
  bikeId: string,
  question: string,
  topK: number,
) => {
  const chunks = await bikeManualChunkModel
    .find({ bike: bikeId })
    .select("chunkIndex chunkText")
    .lean();

  return scoreAndRankChunks(chunks, question, topK);
};

export const bikeManualServices = {
  uploadBikeManualIntoDB,
  getBikeManualMetaFromDB,
  deleteBikeManualFromDB,
  getRelevantManualChunksForChat,
};
