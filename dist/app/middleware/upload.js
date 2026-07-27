"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upload = void 0;
const multer_1 = __importDefault(require("multer"));
const http_status_1 = __importDefault(require("http-status"));
const multer_storage_cloudinary_1 = require("multer-storage-cloudinary");
const AppError_1 = __importDefault(require("../Error/AppError"));
const cloudinary_1 = require("../util/cloudinary");
const removeExtension = (filename) => {
    return filename.split(".").slice(0, -1).join(".");
};
const storage = new multer_storage_cloudinary_1.CloudinaryStorage({
    cloudinary: cloudinary_1.cloudinary,
    params: {
        public_id: (_req, file) => Math.random().toString(36).substring(2) +
            "-" +
            Date.now() +
            "-" +
            file.fieldname +
            "-" +
            removeExtension(file.originalname),
    },
});
const imageFileFilter = (_req, file, callback) => {
    if (!file.mimetype.startsWith("image/")) {
        callback(new AppError_1.default(http_status_1.default.BAD_REQUEST, "Only image files are allowed"));
        return;
    }
    callback(null, true);
};
exports.upload = (0, multer_1.default)({
    storage,
    fileFilter: imageFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 },
});
