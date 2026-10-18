import { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import multer, { FileFilterCallback } from "multer";
import { CloudinaryStorage, Options } from "multer-storage-cloudinary";
import AppError from "../Error/AppError";
import { cloudinary } from "../util/cloudinary";

// ! Spec 53 D3 — a SEPARATE multer instance, not a tweak to `upload.ts`. Two things have to
// ! differ (a Cloudinary folder plus a transformation, and a smaller size cap) and `upload` is
// ! shared by `bikeAccessory` and `bikeIssue`, whose behaviour must not change.

const removeExtension = (filename: string) => {
  return filename.split(".").slice(0, -1).join(".");
};

// ! `folder` and `transformation` are both real, documented Cloudinary upload options and
// ! both exist on `UploadApiOptions` — but `multer-storage-cloudinary` derives its own
// ! `Params` type through a `KnownKeys<UploadApiOptions>` helper meant to strip that
// ! interface's `[futureKey: string]: any` index signature. Under current TypeScript that
// ! helper collapses to `never`, so `Params` admits `public_id` and nothing else, and `tsc`
// ! rejects `folder` with TS2353. The cast is therefore on the library's typing, not on ours:
// ! it is scoped to this one object so the exported `uploadAvatar` keeps its real multer type.
// ! `folder` is the key that forces it; `transformation` would fail identically.
const avatarStorageParams = {
  // ! Keeps avatars out of the flat bucket root every other upload lands in.
  folder: "bikelog/avatars",
  // ! 512 square, filled, face-centred. The app deliberately does NO client-side resize —
  // ! that would need `expo-image-manipulator`, a native module, and therefore a fresh EAS
  // ! build (bikelog_app spec 56 D6) — so normalising the asset happens here instead.
  transformation: [{ width: 512, height: 512, crop: "fill", gravity: "face" }],
  public_id: (_req: Request, file: Express.Multer.File) =>
    Math.random().toString(36).substring(2) +
    "-" +
    Date.now() +
    "-" +
    file.fieldname +
    "-" +
    removeExtension(file.originalname),
};

const storage = new CloudinaryStorage({
  cloudinary,
  params: avatarStorageParams as unknown as Options["params"],
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

export const uploadAvatar = multer({
  storage,
  fileFilter: imageFileFilter,
  // ! 4 MB, not upload.ts's 5: Vercel refuses a request body over ~4.5 MB before it ever
  // ! reaches multer, so a 5 MB cap would make the clean 400 below unreachable in production.
  // ! An avatar is re-encoded to 512x512 on arrival anyway, so 4 MB is already generous.
  limits: { fileSize: 4 * 1024 * 1024 },
});

// ! multer.MulterError (the 4 MB breach, or a part named anything but "image") isn't an
// ! AppError and has no `.status`, so globalErrorHandler's generic fallback would turn the
// ! single likeliest client error on this route into an unhelpful 500 — normalize it to a
// ! clean 400 here. Same shape as `bikeDocument.route.ts`'s `handleDocumentUpload`, but kept
// ! in the middleware file so `user.route.ts` stays declarative.
export const handleAvatarUpload = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  uploadAvatar.single("image")(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      return next(new AppError(httpStatus.BAD_REQUEST, error.message));
    }
    if (error) {
      return next(error);
    }
    next();
  });
};
