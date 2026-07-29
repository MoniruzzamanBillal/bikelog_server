"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadDocument = void 0;
const multer_1 = __importDefault(require("multer"));
const http_status_1 = __importDefault(require("http-status"));
const AppError_1 = __importDefault(require("../Error/AppError"));
const documentFileFilter = (_req, file, callback) => {
    if (!file.mimetype.startsWith("image/") && file.mimetype !== "application/pdf") {
        callback(new AppError_1.default(http_status_1.default.BAD_REQUEST, "Only image or PDF files are allowed"));
        return;
    }
    callback(null, true);
};
// ! separate memoryStorage instance — the Cloudinary resource_type (image vs raw) depends on
// ! each file's own mimetype, which upload.ts's CloudinaryStorage can't branch on per-file
exports.uploadDocument = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    fileFilter: documentFileFilter,
    limits: { fileSize: 20 * 1024 * 1024 },
});
