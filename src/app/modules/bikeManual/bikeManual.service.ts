import httpStatus from "http-status";
import pdfParse from "pdf-parse";
import AppError from "../../Error/AppError";
import { prisma } from "../../lib/prisma";
import { generateObjectId } from "../../util/generateObjectId";
import { findOwnedBikeOrThrow, updateBikeManual } from "../bike/bike.utils";
import { deleteCloudinaryImage, uploadRawBuffer } from "../../util/cloudinary";
import {
  chunkManualText,
  scoreAndRankChunks,
  tokenize,
} from "./bikeManual.utils";
import { TBikeManualMeta } from "./bikeManual.interface";

// ! backstop on the keyword pre-filter so a very common word can't pull the whole manual back
const MANUAL_CANDIDATE_CEILING = 40;

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
    await prisma.bikeManualChunk.deleteMany({ where: { bikeId } });
  }

  const { url, publicId } = await uploadRawBuffer(file.buffer, file.originalname);

  await prisma.bikeManualChunk.createMany({
    data: chunkTexts.map((chunkText, chunkIndex) => ({
      id: generateObjectId(),
      bikeId,
      chunkIndex,
      chunkText,
    })),
  });

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
  await prisma.bikeManualChunk.deleteMany({ where: { bikeId } });

  await updateBikeManual(bikeId, null);

  return null;
};

// ! the only function ai.service.ts imports from this module
const getRelevantManualChunksForChat = async (
  bikeId: string,
  question: string,
  topK: number,
) => {
  const select = { chunkIndex: true, chunkText: true } as const;
  const keywords = Array.from(new Set(tokenize(question)));

  // ! scoreAndRankChunks needs a candidate set to rank, but pulling every chunk (~120 KB per
  // ! manual) across regions on each message is the largest payload in the chat path. Pre-filter
  // ! in SQL on the question's keywords; fall back to the full read only when nothing matches.
  // ! Proper Postgres full-text search is the real fix and belongs in its own spec.
  let chunks =
    keywords.length > 0
      ? await prisma.bikeManualChunk.findMany({
          where: {
            bikeId,
            OR: keywords.map((keyword) => ({
              chunkText: { contains: keyword, mode: "insensitive" as const },
            })),
          },
          select,
          take: MANUAL_CANDIDATE_CEILING,
        })
      : [];

  if (chunks.length === 0) {
    chunks = await prisma.bikeManualChunk.findMany({
      where: { bikeId },
      select,
    });
  }

  return scoreAndRankChunks(chunks, question, topK);
};

export const bikeManualServices = {
  uploadBikeManualIntoDB,
  getBikeManualMetaFromDB,
  deleteBikeManualFromDB,
  getRelevantManualChunksForChat,
};
