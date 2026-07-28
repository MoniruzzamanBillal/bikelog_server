import multer, { FileFilterCallback } from "multer";
import { Request } from "express";
import httpStatus from "http-status";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import AppError from "../Error/AppError";
import { cloudinary } from "../util/cloudinary";

const removeExtension = (filename: string) => {
  return filename.split(".").slice(0, -1).join(".");
};

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    public_id: (_req: Request, file: Express.Multer.File) =>
      Math.random().toString(36).substring(2) +
      "-" +
      Date.now() +
      "-" +
      file.fieldname +
      "-" +
      removeExtension(file.originalname),
  },
});

const imageFileFilter = (
  _req: Request,
  file: Express.Multer.File,
  callback: FileFilterCallback,
) => {
  if (!file.mimetype.startsWith("image/")) {
    callback(new AppError(httpStatus.BAD_REQUEST, "Only image files are allowed"));
    return;
  }
  callback(null, true);
};

export const upload = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});
