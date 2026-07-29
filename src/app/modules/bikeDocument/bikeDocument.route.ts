import { NextFunction, Request, Response, Router } from "express";
import httpStatus from "http-status";
import multer from "multer";
import AppError from "../../Error/AppError";
import authCheck from "../../middleware/authCheck";
import validateRequest from "../../middleware/validateRequest";
import { uploadDocument } from "../../middleware/uploadDocument";
import { bikeDocumentController } from "./bikeDocument.controller";
import { bikeDocumentValidations } from "./bikeDocument.validation";

// ! multer.MulterError (e.g. exceeding the 10-file cap, or a per-file size-limit breach) isn't
// ! an AppError and has no `.status`, so globalErrorHandler's generic fallback would otherwise
// ! turn it into an unhelpful 500 — normalize it to a clean 400 here, scoped to just this route
const handleDocumentUpload = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  uploadDocument.array("files", 10)(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      return next(new AppError(httpStatus.BAD_REQUEST, error.message));
    }
    if (error) {
      return next(error);
    }
    next();
  });
};

// ! mounted at /bikes/:bikeId/documents
const router = Router({ mergeParams: true });

router.post(
  "/",
  authCheck,
  validateRequest(bikeDocumentValidations.createBikeDocumentSchema),
  bikeDocumentController.createBikeDocument,
);

router.get("/", authCheck, bikeDocumentController.getBikeDocuments);

router.get("/:id", authCheck, bikeDocumentController.getBikeDocumentById);

router.patch(
  "/:id",
  authCheck,
  validateRequest(bikeDocumentValidations.updateBikeDocumentSchema),
  bikeDocumentController.updateBikeDocument,
);

router.delete("/:id", authCheck, bikeDocumentController.deleteBikeDocument);

// ! for adding one or more files, image or PDF (up to 10 per request)
router.post(
  "/:id/files",
  authCheck,
  handleDocumentUpload,
  bikeDocumentController.addBikeDocumentFiles,
);

// ! for removing a single file by its own subdocument id
router.delete(
  "/:id/files/:fileId",
  authCheck,
  bikeDocumentController.deleteBikeDocumentFile,
);

//
export const bikeDocumentRouter = router;
