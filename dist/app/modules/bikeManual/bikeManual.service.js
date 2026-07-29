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
exports.bikeManualServices = void 0;
const http_status_1 = __importDefault(require("http-status"));
const pdf_parse_1 = __importDefault(require("pdf-parse"));
const AppError_1 = __importDefault(require("../../Error/AppError"));
const bike_utils_1 = require("../bike/bike.utils");
const cloudinary_1 = require("../../util/cloudinary");
const bikeManual_model_1 = require("./bikeManual.model");
const bikeManual_utils_1 = require("./bikeManual.utils");
const uploadBikeManualIntoDB = (bikeId, userId, file) => __awaiter(void 0, void 0, void 0, function* () {
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    if (!file) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "A PDF manual file is required");
    }
    // ! extract before touching Cloudinary/DB so a bad upload fails with zero side effects
    const { text } = yield (0, pdf_parse_1.default)(file.buffer);
    if (!text || text.trim().length === 0) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "Could not extract text from this PDF");
    }
    const chunkTexts = (0, bikeManual_utils_1.chunkManualText)(text);
    // ! replace case — delete old asset + chunks before uploading/inserting the new ones
    if (bike.manual) {
        yield (0, cloudinary_1.deleteCloudinaryImage)(bike.manual.publicId, "raw");
        yield bikeManual_model_1.bikeManualChunkModel.deleteMany({ bike: bikeId });
    }
    const { url, publicId } = yield (0, cloudinary_1.uploadRawBuffer)(file.buffer, file.originalname);
    yield bikeManual_model_1.bikeManualChunkModel.insertMany(chunkTexts.map((chunkText, chunkIndex) => ({
        bike: bikeId,
        chunkIndex,
        chunkText,
    })));
    bike.manual = {
        url,
        publicId,
        originalName: file.originalname,
        uploadedAt: new Date(),
        chunkCount: chunkTexts.length,
    };
    yield bike.save();
    return bike.manual;
});
const getBikeManualMetaFromDB = (bikeId, userId) => __awaiter(void 0, void 0, void 0, function* () {
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    if (!bike.manual) {
        return { hasManual: false, manual: null };
    }
    return { hasManual: true, manual: bike.manual };
});
const deleteBikeManualFromDB = (bikeId, userId) => __awaiter(void 0, void 0, void 0, function* () {
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    if (!bike.manual) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "This bike has no manual uploaded");
    }
    yield (0, cloudinary_1.deleteCloudinaryImage)(bike.manual.publicId, "raw");
    yield bikeManual_model_1.bikeManualChunkModel.deleteMany({ bike: bikeId });
    bike.manual = undefined;
    yield bike.save();
    return null;
});
// ! the only function ai.service.ts imports from this module
const getRelevantManualChunksForChat = (bikeId, question, topK) => __awaiter(void 0, void 0, void 0, function* () {
    const chunks = yield bikeManual_model_1.bikeManualChunkModel
        .find({ bike: bikeId })
        .select("chunkIndex chunkText")
        .lean();
    return (0, bikeManual_utils_1.scoreAndRankChunks)(chunks, question, topK);
});
exports.bikeManualServices = {
    uploadBikeManualIntoDB,
    getBikeManualMetaFromDB,
    deleteBikeManualFromDB,
    getRelevantManualChunksForChat,
};
