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
exports.bikeIssueServices = void 0;
const http_status_1 = __importDefault(require("http-status"));
const AppError_1 = __importDefault(require("../../Error/AppError"));
const prisma_1 = require("../../lib/prisma");
const generateObjectId_1 = require("../../util/generateObjectId");
const buildPrismaListQuery_1 = require("../../builder/buildPrismaListQuery");
const bike_utils_1 = require("../bike/bike.utils");
const bikeIssue_constant_1 = require("./bikeIssue.constant");
const cloudinary_1 = require("../../util/cloudinary");
const toApiShape = (issue) => (Object.assign(Object.assign({}, issue), { _id: issue.id, bike: issue.bikeId }));
const getImages = (issue) => { var _a; return (_a = issue.images) !== null && _a !== void 0 ? _a : []; };
const createBikeIssueIntoDB = (bikeId, userId, payload) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const issue = yield prisma_1.prisma.bikeIssue.create({
        data: {
            id: (0, generateObjectId_1.generateObjectId)(),
            bikeId,
            title: payload.title,
            description: payload.description,
            dateReported: (_a = payload.dateReported) !== null && _a !== void 0 ? _a : new Date(),
            status: bikeIssue_constant_1.BikeIssueStatus.open,
        },
    });
    return toApiShape(issue);
});
const getBikeIssuesFromDB = (bikeId, userId, query) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    // ! strip client-controlled "bike"/"isDeleted" keys before they reach buildPrismaListQuery —
    // ! it merges whatever's left in query as equality filters, and an unsanitized
    // ! `?bike=<otherBikeId>` would silently override the ownership-scoped filter below
    const sanitizedQuery = Object.assign({}, query);
    delete sanitizedQuery.bike;
    delete sanitizedQuery.isDeleted;
    const { where, orderBy, skip, take } = (0, buildPrismaListQuery_1.buildPrismaListQuery)({
        baseWhere: { bikeId, isDeleted: false },
        query: sanitizedQuery,
        defaultSort: "status -dateReported",
    });
    const [result, meta] = yield Promise.all([
        prisma_1.prisma.bikeIssue.findMany({ where, orderBy, skip, take }),
        prisma_1.prisma.bikeIssue.count({ where }),
    ]);
    return { result: result.map(toApiShape), meta };
});
const getBikeIssueByIdFromDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const issue = yield prisma_1.prisma.bikeIssue.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!issue) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike issue not found");
    }
    return toApiShape(issue);
});
const updateBikeIssueInDB = (bikeId, userId, id, payload) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const issue = yield prisma_1.prisma.bikeIssue.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!issue) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike issue not found");
    }
    const updateData = Object.assign({}, payload);
    delete updateData.status;
    const updated = yield prisma_1.prisma.bikeIssue.update({
        where: { id: issue.id },
        data: updateData,
    });
    return toApiShape(updated);
});
const deleteBikeIssueFromDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const issue = yield prisma_1.prisma.bikeIssue.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!issue) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike issue not found");
    }
    const updated = yield prisma_1.prisma.bikeIssue.update({
        where: { id: issue.id },
        data: { isDeleted: true },
    });
    return toApiShape(updated);
});
// ! open -> resolved when fixed, resolved -> open again if the same problem recurs
const updateBikeIssueStatus = (bikeId, userId, id, status) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const issue = yield prisma_1.prisma.bikeIssue.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!issue) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike issue not found");
    }
    if (issue.status === status) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, `Issue is already ${status}`);
    }
    const updated = yield prisma_1.prisma.bikeIssue.update({
        where: { id: issue.id },
        data: { status },
    });
    return toApiShape(updated);
});
const addBikeIssueImagesIntoDB = (bikeId, userId, id, files) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    if (!files || files.length === 0) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "At least one image file is required");
    }
    const issue = yield prisma_1.prisma.bikeIssue.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!issue) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike issue not found");
    }
    const newImages = files.map((file) => ({
        _id: (0, generateObjectId_1.generateObjectId)(),
        url: file.path,
        publicId: file.filename,
    }));
    const updated = yield prisma_1.prisma.bikeIssue.update({
        where: { id: issue.id },
        data: { images: [...getImages(issue), ...newImages] },
    });
    return toApiShape(updated);
});
const deleteBikeIssueImageFromDB = (bikeId, userId, id, imageId) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const issue = yield prisma_1.prisma.bikeIssue.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!issue) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike issue not found");
    }
    const existingImages = getImages(issue);
    const targetImage = existingImages.find((image) => image._id === imageId);
    if (!targetImage) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Image not found");
    }
    yield (0, cloudinary_1.deleteCloudinaryImage)(targetImage.publicId);
    const remaining = existingImages.filter((image) => image._id !== imageId);
    const updated = yield prisma_1.prisma.bikeIssue.update({
        where: { id: issue.id },
        data: { images: remaining },
    });
    return toApiShape(updated);
});
exports.bikeIssueServices = {
    createBikeIssueIntoDB,
    getBikeIssuesFromDB,
    getBikeIssueByIdFromDB,
    updateBikeIssueInDB,
    deleteBikeIssueFromDB,
    updateBikeIssueStatus,
    addBikeIssueImagesIntoDB,
    deleteBikeIssueImageFromDB,
};
