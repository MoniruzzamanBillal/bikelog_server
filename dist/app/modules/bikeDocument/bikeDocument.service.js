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
const prisma_1 = require("../../lib/prisma");
const generateObjectId_1 = require("../../util/generateObjectId");
const buildPrismaListQuery_1 = require("../../builder/buildPrismaListQuery");
const bike_utils_1 = require("../bike/bike.utils");
const cloudinary_1 = require("../../util/cloudinary");
const toApiShape = (doc) => (Object.assign(Object.assign({}, doc), { _id: doc.id, bike: doc.bikeId }));
const getFiles = (doc) => { var _a; return (_a = doc.files) !== null && _a !== void 0 ? _a : []; };
const createBikeDocumentIntoDB = (bikeId, userId, payload) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const document = yield prisma_1.prisma.bikeDocument.create({
        data: {
            id: (0, generateObjectId_1.generateObjectId)(),
            bikeId,
            title: payload.title,
            description: payload.description,
            expiryDate: payload.expiryDate,
        },
    });
    return toApiShape(document);
});
const getBikeDocumentsFromDB = (bikeId, userId, query) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    // ! strip client-controlled "bike"/"isDeleted" keys before they reach the filter/query logic —
    // ! an unsanitized `?bike=<otherBikeId>` would otherwise override the ownership-scoped filter below
    const sanitizedQuery = Object.assign({}, query);
    delete sanitizedQuery.bike;
    delete sanitizedQuery.isDeleted;
    const baseWhere = { bikeId, isDeleted: false };
    // ! client-provided sort fully overrides the default expiry-first ordering below
    if (sanitizedQuery.sort) {
        const { where, orderBy, skip, take } = (0, buildPrismaListQuery_1.buildPrismaListQuery)({
            baseWhere,
            query: sanitizedQuery,
            defaultSort: "-createdAt", // unused when query.sort is present, kept for signature consistency
        });
        const [result, meta] = yield Promise.all([
            prisma_1.prisma.bikeDocument.findMany({ where, orderBy, skip, take }),
            prisma_1.prisma.bikeDocument.count({ where }),
        ]);
        return { result: result.map(toApiShape), meta };
    }
    // ! no single Postgres sort can express "earliest expiry first, no-expiry documents last"
    // ! (ascending sort treats NULL as less-than-any-value, i.e. first, not last) without a
    // ! window function/aggregation — this codebase's house style avoids those (see
    // ! bikeAccessory's getBikeAccessoriesFromDB, spec 13) in favor of one plain findMany() per
    // ! group, concatenated in a fixed order, then paginated in memory
    const limit = Number(sanitizedQuery.limit) || 10;
    const page = Number(sanitizedQuery.page) || 1;
    const skip = (page - 1) * limit;
    const [withExpiry, withoutExpiry, meta] = yield Promise.all([
        prisma_1.prisma.bikeDocument.findMany({
            where: Object.assign(Object.assign({}, baseWhere), { expiryDate: { not: null } }),
            orderBy: { expiryDate: "asc" },
        }),
        prisma_1.prisma.bikeDocument.findMany({
            where: Object.assign(Object.assign({}, baseWhere), { expiryDate: null }),
            orderBy: { createdAt: "desc" },
        }),
        prisma_1.prisma.bikeDocument.count({ where: baseWhere }),
    ]);
    const result = [...withExpiry, ...withoutExpiry]
        .slice(skip, skip + limit)
        .map(toApiShape);
    return { result, meta };
});
const getBikeDocumentByIdFromDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const document = yield prisma_1.prisma.bikeDocument.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!document) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike document not found");
    }
    return toApiShape(document);
});
const updateBikeDocumentIntoDB = (bikeId, userId, id, payload) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const document = yield prisma_1.prisma.bikeDocument.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!document) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike document not found");
    }
    const updated = yield prisma_1.prisma.bikeDocument.update({
        where: { id: document.id },
        data: payload,
    });
    return toApiShape(updated);
});
const deleteBikeDocumentFromDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const document = yield prisma_1.prisma.bikeDocument.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!document) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike document not found");
    }
    // ! best-effort cleanup — a failed Cloudinary delete shouldn't block the user's own delete
    const files = getFiles(document);
    if (files.length) {
        yield Promise.all(files.map((file) => (0, cloudinary_1.deleteCloudinaryImage)(file.publicId, file.resourceType)));
    }
    const updated = yield prisma_1.prisma.bikeDocument.update({
        where: { id: document.id },
        data: { isDeleted: true },
    });
    return toApiShape(updated);
});
const addBikeDocumentFilesIntoDB = (bikeId, userId, id, files) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    if (!files || files.length === 0) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "At least one image or PDF file is required");
    }
    const document = yield prisma_1.prisma.bikeDocument.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!document) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike document not found");
    }
    // ! uploaded in parallel — this middleware uses memoryStorage (unlike bikeIssue's
    // ! CloudinaryStorage-backed upload.ts), so each buffer needs its own manual upload call
    const uploadedFiles = yield Promise.all(files.map((file) => __awaiter(void 0, void 0, void 0, function* () {
        const { url, publicId, resourceType } = yield (0, cloudinary_1.uploadDocumentBuffer)(file.buffer, file.originalname, file.mimetype);
        return {
            _id: (0, generateObjectId_1.generateObjectId)(),
            url,
            publicId,
            resourceType,
            originalName: file.originalname,
            mimeType: file.mimetype,
        };
    })));
    const updated = yield prisma_1.prisma.bikeDocument.update({
        where: { id: document.id },
        data: { files: [...getFiles(document), ...uploadedFiles] },
    });
    return toApiShape(updated);
});
const deleteBikeDocumentFileFromDB = (bikeId, userId, id, fileId) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const document = yield prisma_1.prisma.bikeDocument.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!document) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike document not found");
    }
    const existingFiles = getFiles(document);
    const targetFile = existingFiles.find((file) => file._id === fileId);
    if (!targetFile) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "File not found");
    }
    yield (0, cloudinary_1.deleteCloudinaryImage)(targetFile.publicId, targetFile.resourceType);
    const remaining = existingFiles.filter((file) => file._id !== fileId);
    const updated = yield prisma_1.prisma.bikeDocument.update({
        where: { id: document.id },
        data: { files: remaining },
    });
    return toApiShape(updated);
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
