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
exports.bikeDocumentServices = void 0;
const http_status_1 = __importDefault(require("http-status"));
const AppError_1 = __importDefault(require("../../Error/AppError"));
const Queryuilder_1 = __importDefault(require("../../builder/Queryuilder"));
const bike_utils_1 = require("../bike/bike.utils");
const cloudinary_1 = require("../../util/cloudinary");
const bikeDocument_model_1 = require("./bikeDocument.model");
const createBikeDocumentIntoDB = (bikeId, userId, payload) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const documentData = Object.assign(Object.assign({}, payload), { bike: bikeId });
    const document = yield bikeDocument_model_1.bikeDocumentModel.create(documentData);
    return document;
});
const getBikeDocumentsFromDB = (bikeId, userId, query) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    // ! strip client-controlled "bike"/"isDeleted" keys before they reach QueryBuilder.filter() —
    // ! its .find(queryObj) call merges into the query and a later key wins, so an unsanitized
    // ! `?bike=<otherBikeId>` would silently override the ownership-scoped filter below
    const sanitizedQuery = Object.assign({}, query);
    delete sanitizedQuery.bike;
    delete sanitizedQuery.isDeleted;
    const limit = Number(sanitizedQuery.limit) || 10;
    const page = Number(sanitizedQuery.page) || 1;
    const skip = (page - 1) * limit;
    const baseFilter = { bike: bikeId, isDeleted: false };
    // ! client-provided sort fully overrides the default expiry-first ordering below
    if (sanitizedQuery.sort) {
        const documentsQuery = new Queryuilder_1.default(bikeDocument_model_1.bikeDocumentModel.find(baseFilter), sanitizedQuery)
            .filter()
            .sort()
            .pagination()
            .field();
        const result = yield documentsQuery.queryModel;
        const meta = yield documentsQuery.countTotal();
        return { result, meta };
    }
    // ! no single Mongo sort field can express "earliest expiry first, no-expiry documents
    // ! last" (ascending sort treats a missing field as less-than-any-value, i.e. first, not
    // ! last) without an aggregation pipeline — this codebase's house style avoids those (see
    // ! bikeAccessory's getBikeAccessoriesFromDB, spec 13) in favor of one plain find() per
    // ! group, concatenated in a fixed order, then paginated in memory
    const [withExpiry, withoutExpiry, meta] = yield Promise.all([
        bikeDocument_model_1.bikeDocumentModel
            .find(Object.assign(Object.assign({}, baseFilter), { expiryDate: { $ne: null } }))
            .sort("expiryDate"),
        bikeDocument_model_1.bikeDocumentModel
            .find(Object.assign(Object.assign({}, baseFilter), { expiryDate: null }))
            .sort("-createdAt"),
        bikeDocument_model_1.bikeDocumentModel.countDocuments(baseFilter),
    ]);
    const result = [...withExpiry, ...withoutExpiry].slice(skip, skip + limit);
    return { result, meta };
});
const getBikeDocumentByIdFromDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const document = yield bikeDocument_model_1.bikeDocumentModel.findOne({
        _id: id,
        bike: bikeId,
        isDeleted: false,
    });
    if (!document) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike document not found");
    }
    return document;
});
const updateBikeDocumentIntoDB = (bikeId, userId, id, payload) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const document = yield bikeDocument_model_1.bikeDocumentModel.findOne({
        _id: id,
        bike: bikeId,
        isDeleted: false,
    });
    if (!document) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike document not found");
    }
    Object.assign(document, payload);
    yield document.save();
    return document;
});
const deleteBikeDocumentFromDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const document = yield bikeDocument_model_1.bikeDocumentModel.findOne({
        _id: id,
        bike: bikeId,
        isDeleted: false,
    });
    if (!document) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike document not found");
    }
    // ! best-effort cleanup — a failed Cloudinary delete shouldn't block the user's own delete
    if ((_a = document.files) === null || _a === void 0 ? void 0 : _a.length) {
        yield Promise.all(document.files.map((file) => (0, cloudinary_1.deleteCloudinaryImage)(file.publicId, file.resourceType)));
    }
    document.isDeleted = true;
    yield document.save();
    return document;
});
const addBikeDocumentFilesIntoDB = (bikeId, userId, id, files) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    if (!files || files.length === 0) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "At least one image or PDF file is required");
    }
    const document = yield bikeDocument_model_1.bikeDocumentModel.findOne({
        _id: id,
        bike: bikeId,
        isDeleted: false,
    });
    if (!document) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike document not found");
    }
    // ! uploaded in parallel — this middleware uses memoryStorage (unlike bikeIssue's
    // ! CloudinaryStorage-backed upload.ts), so each buffer needs its own manual upload call
    const uploadedFiles = yield Promise.all(files.map((file) => __awaiter(void 0, void 0, void 0, function* () {
        const { url, publicId, resourceType } = yield (0, cloudinary_1.uploadDocumentBuffer)(file.buffer, file.originalname, file.mimetype);
        return {
            url,
            publicId,
            resourceType,
            originalName: file.originalname,
            mimeType: file.mimetype,
        };
    })));
    document.files = [...((_a = document.files) !== null && _a !== void 0 ? _a : []), ...uploadedFiles];
    yield document.save();
    return document;
});
const deleteBikeDocumentFileFromDB = (bikeId, userId, id, fileId) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const document = yield bikeDocument_model_1.bikeDocumentModel.findOne({
        _id: id,
        bike: bikeId,
        isDeleted: false,
    });
    if (!document) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike document not found");
    }
    const targetFile = (_a = document.files) === null || _a === void 0 ? void 0 : _a.find((file) => { var _a; return ((_a = file._id) === null || _a === void 0 ? void 0 : _a.toString()) === fileId; });
    if (!targetFile) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "File not found");
    }
    yield (0, cloudinary_1.deleteCloudinaryImage)(targetFile.publicId, targetFile.resourceType);
    document.files = (_b = document.files) === null || _b === void 0 ? void 0 : _b.filter((file) => { var _a; return ((_a = file._id) === null || _a === void 0 ? void 0 : _a.toString()) !== fileId; });
    yield document.save();
    return document;
});
exports.bikeDocumentServices = {
    createBikeDocumentIntoDB,
    getBikeDocumentsFromDB,
    getBikeDocumentByIdFromDB,
    updateBikeDocumentIntoDB,
    deleteBikeDocumentFromDB,
    addBikeDocumentFilesIntoDB,
    deleteBikeDocumentFileFromDB,
};
