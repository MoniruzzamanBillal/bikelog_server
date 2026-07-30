import multer, { FileFilterCallback } from "multer";
import { Request } from "express";
import httpStatus from "http-status";
import AppError from "../Error/AppError";

const documentFileFilter = (
  _req: Request,
  file: Express.Multer.File,
  callback: FileFilterCallback,
) => {
  if (!file.mimetype.startsWith("image/") && file.mimetype !== "application/pdf") {
    callback(
      new AppError(httpStatus.BAD_REQUEST, "Only image or PDF files are allowed"),
    );
    return;
  }
  callback(null, true);
};

// ! separate memoryStorage instance — the Cloudinary resource_type (image vs raw) depends on
// ! each file's own mimetype, which upload.ts's CloudinaryStorage can't branch on per-file
export const uploadDocument = multer({
  storage: multer.memoryStorage(),
  fileFilter: documentFileFilter,
  limits: { fileSize: 20 * 1024 * 1024 },
});
