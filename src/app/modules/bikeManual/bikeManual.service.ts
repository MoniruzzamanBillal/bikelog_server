import httpStatus from "http-status";
import pdfParse from "pdf-parse";
import AppError from "../../Error/AppError";
import { findOwnedBikeOrThrow, updateBikeManual } from "../bike/bike.utils";
import { deleteCloudinaryImage, uploadRawBuffer } from "../../util/cloudinary";
import { bikeManualChunkModel } from "./bikeManual.model";
import { chunkManualText, scoreAndRankChunks } from "./bikeManual.utils";
import { TBikeManualMeta } from "./bikeManual.interface";

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

  // ! bike.manual is a Prisma Json? column, deserialized as an untyped JsonValue —
  // ! cast to the known shape rather than typing findOwnedBikeOrThrow's return itself
  const existingManual = bike.manual as TBikeManualMeta | null;

  // ! replace case — delete old asset + chunks before uploading/inserting the new ones
  if (existingManual) {
    await deleteCloudinaryImage(existingManual.publicId, "raw");
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

  const manual: TBikeManualMeta = {
    url,
    publicId,
    originalName: file.originalname,
    uploadedAt: new Date(),
    chunkCount: chunkTexts.length,
  };
  await updateBikeManual(bikeId, manual);

  return manual;
};

const getBikeManualMetaFromDB = async (bikeId: string, userId: string) => {
  const bike = await findOwnedBikeOrThrow(bikeId, userId);
  const manual = bike.manual as TBikeManualMeta | null;

  if (!manual) {
    return { hasManual: false, manual: null };
  }

  return { hasManual: true, manual };
};

const deleteBikeManualFromDB = async (bikeId: string, userId: string) => {
  const bike = await findOwnedBikeOrThrow(bikeId, userId);
  const manual = bike.manual as TBikeManualMeta | null;

  if (!manual) {
    throw new AppError(httpStatus.NOT_FOUND, "This bike has no manual uploaded");
  }

  await deleteCloudinaryImage(manual.publicId, "raw");
  await bikeManualChunkModel.deleteMany({ bike: bikeId });

  await updateBikeManual(bikeId, null);

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
