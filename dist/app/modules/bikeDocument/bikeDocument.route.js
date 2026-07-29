"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bikeDocumentRouter = void 0;
const express_1 = require("express");
const http_status_1 = __importDefault(require("http-status"));
const multer_1 = __importDefault(require("multer"));
const AppError_1 = __importDefault(require("../../Error/AppError"));
const authCheck_1 = __importDefault(require("../../middleware/authCheck"));
const validateRequest_1 = __importDefault(require("../../middleware/validateRequest"));
const uploadDocument_1 = require("../../middleware/uploadDocument");
const bikeDocument_controller_1 = require("./bikeDocument.controller");
const bikeDocument_validation_1 = require("./bikeDocument.validation");
// ! multer.MulterError (e.g. exceeding the 10-file cap, or a per-file size-limit breach) isn't
// ! an AppError and has no `.status`, so globalErrorHandler's generic fallback would otherwise
// ! turn it into an unhelpful 500 — normalize it to a clean 400 here, scoped to just this route
const handleDocumentUpload = (req, res, next) => {
    uploadDocument_1.uploadDocument.array("files", 10)(req, res, (error) => {
        if (error instanceof multer_1.default.MulterError) {
            return next(new AppError_1.default(http_status_1.default.BAD_REQUEST, error.message));
        }
        if (error) {
            return next(error);
        }
        next();
    });
};
// ! mounted at /bikes/:bikeId/documents
const router = (0, express_1.Router)({ mergeParams: true });
router.post("/", authCheck_1.default, (0, validateRequest_1.default)(bikeDocument_validation_1.bikeDocumentValidations.createBikeDocumentSchema), bikeDocument_controller_1.bikeDocumentController.createBikeDocument);
router.get("/", authCheck_1.default, bikeDocument_controller_1.bikeDocumentController.getBikeDocuments);
router.get("/:id", authCheck_1.default, bikeDocument_controller_1.bikeDocumentController.getBikeDocumentById);
router.patch("/:id", authCheck_1.default, (0, validateRequest_1.default)(bikeDocument_validation_1.bikeDocumentValidations.updateBikeDocumentSchema), bikeDocument_controller_1.bikeDocumentController.updateBikeDocument);
router.delete("/:id", authCheck_1.default, bikeDocument_controller_1.bikeDocumentController.deleteBikeDocument);
// ! for adding one or more files, image or PDF (up to 10 per request)
router.post("/:id/files", authCheck_1.default, handleDocumentUpload, bikeDocument_controller_1.bikeDocumentController.addBikeDocumentFiles);
// ! for removing a single file by its own subdocument id
router.delete("/:id/files/:fileId", authCheck_1.default, bikeDocument_controller_1.bikeDocumentController.deleteBikeDocumentFile);
//
exports.bikeDocumentRouter = router;
