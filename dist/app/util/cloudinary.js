"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cloudinary = exports.uploadDocumentBuffer = exports.uploadRawBuffer = exports.deleteCloudinaryImage = void 0;
const cloudinary_1 = require("cloudinary");
Object.defineProperty(exports, "cloudinary", { enumerable: true, get: function () { return cloudinary_1.v2; } });
const config_1 = __importDefault(require("../config"));
cloudinary_1.v2.config({
    cloud_name: config_1.default.cloudinary_cloud_name,
    api_key: config_1.default.cloudinary_api_key,
    api_secret: config_1.default.cloudinary_api_secret,
});
// ! best-effort cleanup — a failed delete shouldn't block the caller's own delete/replace action
const deleteCloudinaryImage = (publicId_1, ...args_1) => __awaiter(void 0, [publicId_1, ...args_1], void 0, function* (publicId, resourceType = "image") {
    try {
        yield cloudinary_1.v2.uploader.destroy(publicId, { resource_type: resourceType });
    }
    catch (error) {
        console.error(`Failed to delete Cloudinary image "${publicId}":`, error);
    }
});
exports.deleteCloudinaryImage = deleteCloudinaryImage;
// ! for non-image files (e.g. PDFs) that need the raw resource type and local buffer upload,
// ! unlike upload.ts's CloudinaryStorage which streams image files directly
const uploadRawBuffer = (buffer, originalName) => {
    return new Promise((resolve, reject) => {
        const publicId = Math.random().toString(36).substring(2) + "-" + Date.now() + "-" + originalName;
        const uploadStream = cloudinary_1.v2.uploader.upload_stream({ resource_type: "raw", public_id: publicId }, (error, result) => {
            if (error || !result) {
                reject(error !== null && error !== void 0 ? error : new Error("Cloudinary raw upload failed"));
                return;
            }
            resolve({ url: result.secure_url, publicId: result.public_id });
        });
        uploadStream.end(buffer);
    });
};
exports.uploadRawBuffer = uploadRawBuffer;
// ! for mixed image/PDF multi-file uploads (bikeDocument) — picks resource_type per file's
// ! mimetype so an image is stored/served as "image" and a PDF as "raw", unlike uploadRawBuffer
// ! above which always hardcodes "raw" (fine for bikeManual, which is PDF-only)
const uploadDocumentBuffer = (buffer, originalName, mimetype) => {
    return new Promise((resolve, reject) => {
        const resourceType = mimetype.startsWith("image/")
            ? "image"
            : "raw";
        const publicId = Math.random().toString(36).substring(2) + "-" + Date.now() + "-" + originalName;
        const uploadStream = cloudinary_1.v2.uploader.upload_stream({ resource_type: resourceType, public_id: publicId }, (error, result) => {
            if (error || !result) {
                reject(error !== null && error !== void 0 ? error : new Error("Cloudinary document upload failed"));
                return;
            }
            resolve({ url: result.secure_url, publicId: result.public_id, resourceType });
        });
        uploadStream.end(buffer);
    });
};
exports.uploadDocumentBuffer = uploadDocumentBuffer;
