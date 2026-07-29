"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadManual = void 0;
const multer_1 = __importDefault(require("multer"));
const http_status_1 = __importDefault(require("http-status"));
const AppError_1 = __importDefault(require("../Error/AppError"));
const pdfFileFilter = (_req, file, callback) => {
    if (file.mimetype !== "application/pdf") {
        callback(new AppError_1.default(http_status_1.default.BAD_REQUEST, "Only PDF files are allowed"));
        return;
    }
    callback(null, true);
};
// ! separate memoryStorage instance — manual text extraction needs raw file bytes locally,
// ! unlike upload.ts's image `upload` which streams straight to Cloudinary and never exposes them
exports.uploadManual = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    fileFilter: pdfFileFilter,
    limits: { fileSize: 20 * 1024 * 1024 },
});
