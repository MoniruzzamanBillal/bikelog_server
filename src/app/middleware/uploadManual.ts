import multer, { FileFilterCallback } from "multer";
import { Request } from "express";
import httpStatus from "http-status";
import AppError from "../Error/AppError";

const pdfFileFilter = (
  _req: Request,
  file: Express.Multer.File,
  callback: FileFilterCallback,
) => {
  if (file.mimetype !== "application/pdf") {
    callback(new AppError(httpStatus.BAD_REQUEST, "Only PDF files are allowed"));
    return;
  }
  callback(null, true);
};

// ! separate memoryStorage instance — manual text extraction needs raw file bytes locally,
// ! unlike upload.ts's image `upload` which streams straight to Cloudinary and never exposes them
export const uploadManual = multer({
  storage: multer.memoryStorage(),
  fileFilter: pdfFileFilter,
  limits: { fileSize: 20 * 1024 * 1024 },
});
