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
exports.bikeAccessoryServices = void 0;
const client_1 = require("@prisma/client");
const http_status_1 = __importDefault(require("http-status"));
const AppError_1 = __importDefault(require("../../Error/AppError"));
const prisma_1 = require("../../lib/prisma");
const generateObjectId_1 = require("../../util/generateObjectId");
const bike_utils_1 = require("../bike/bike.utils");
const bikeAccessory_constant_1 = require("./bikeAccessory.constant");
const cloudinary_1 = require("../../util/cloudinary");
const toApiShape = (accessory) => (Object.assign(Object.assign({}, accessory), { _id: accessory.id, bike: accessory.bikeId, price: accessory.price !== null ? Number(accessory.price) : null }));
const createBikeAccessoryIntoDB = (bikeId, userId, payload) => __awaiter(void 0, void 0, void 0, function* () {
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    if (payload.status === bikeAccessory_constant_1.AccessoryStatus.purchased && !payload.price) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "Price is required when marking an accessory as purchased");
    }
    const accessory = yield prisma_1.prisma.bikeAccessory.create({
        data: Object.assign({ id: (0, generateObjectId_1.generateObjectId)(), bikeId, name: payload.name, urgency: payload.urgency, status: payload.status, price: payload.price }, (payload.status === bikeAccessory_constant_1.AccessoryStatus.purchased
            ? { purchaseDate: new Date() }
            : {})),
    });
    return { accessory: toApiShape(accessory), bikeNickname: bike.nickname };
});
const getBikeAccessoriesFromDB = (bikeId, userId, query) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    // ! strip client-controlled "bike"/"isDeleted" keys before they reach the filter object —
    // ! an unsanitized `?bike=<otherBikeId>` would otherwise override the ownership-scoped filter below
    const sanitizedQuery = Object.assign({}, query);
    delete sanitizedQuery.bike;
    delete sanitizedQuery.isDeleted;
    const filterQuery = Object.assign({}, sanitizedQuery);
    delete filterQuery.searchTerm;
    delete filterQuery.sort;
    delete filterQuery.limit;
    delete filterQuery.page;
    delete filterQuery.fields;
    // ! grouping is done by running one query per status (in the enum's declared order) and
    // ! merging the results, rather than relying on Postgres enum ordering (not guaranteed to
    // ! match declaration order) or a $group-style aggregation (avoided per house style, see
    // ! context/architecture.md) — same strategy spec 13 chose, ported exactly, not "simplified"
    // ! into a single orderBy: [{status: ...}, ...] query
    const statusOrder = Object.values(bikeAccessory_constant_1.AccessoryStatus);
    const requestedStatuses = typeof filterQuery.status === "string" &&
        statusOrder.includes(filterQuery.status)
        ? [filterQuery.status]
        : statusOrder;
    delete filterQuery.status;
    const sortStr = (typeof sanitizedQuery.sort === "string" ? sanitizedQuery.sort : "") ||
        "-createdAt";
    const orderBy = sortStr
        .trim()
        .split(/[\s,]+/)
        .map((field) => field.startsWith("-")
        ? { [field.slice(1)]: "desc" }
        : { [field]: "asc" });
    const limit = Number(sanitizedQuery.limit) || 10;
    const page = Number(sanitizedQuery.page) || 1;
    const skip = (page - 1) * limit;
    const baseWhere = Object.assign({ bikeId, isDeleted: false }, filterQuery);
    const resultsByStatus = yield Promise.all(requestedStatuses.map((status) => prisma_1.prisma.bikeAccessory.findMany({
        where: Object.assign(Object.assign({}, baseWhere), { status }),
        orderBy,
    })));
    const result = resultsByStatus
        .flat()
        .slice(skip, skip + limit)
        .map(toApiShape);
    const meta = yield prisma_1.prisma.bikeAccessory.count({
        where: Object.assign(Object.assign({}, baseWhere), { status: { in: requestedStatuses } }),
    });
    return { result, meta };
});
const getBikeAccessoryByIdFromDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const accessory = yield prisma_1.prisma.bikeAccessory.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!accessory) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike accessory not found");
    }
    return toApiShape(accessory);
});
const updateBikeAccessoryInDB = (bikeId, userId, id, payload) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const accessory = yield prisma_1.prisma.bikeAccessory.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!accessory) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike accessory not found");
    }
    // ! once purchased, status is a one-way permanent lock — every other field stays editable
    if (accessory.status === bikeAccessory_constant_1.AccessoryStatus.purchased &&
        payload.status !== undefined &&
        payload.status !== bikeAccessory_constant_1.AccessoryStatus.purchased) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "This accessory is already marked as purchased and its status cannot be changed");
    }
    const existingPrice = accessory.price !== null ? Number(accessory.price) : undefined;
    const resultingStatus = (_a = payload.status) !== null && _a !== void 0 ? _a : accessory.status;
    const resultingPrice = (_b = payload.price) !== null && _b !== void 0 ? _b : existingPrice;
    if (resultingStatus === bikeAccessory_constant_1.AccessoryStatus.purchased && !resultingPrice) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "Price is required when marking an accessory as purchased");
    }
    const updateData = Object.assign({}, payload);
    // ! stamp purchaseDate exactly once, at the moment status actually transitions into
    // ! purchased — never re-stamped afterward, since the lock above guarantees this only
    // ! ever fires once per accessory
    const justPurchased = accessory.status !== bikeAccessory_constant_1.AccessoryStatus.purchased &&
        resultingStatus === bikeAccessory_constant_1.AccessoryStatus.purchased;
    if (justPurchased) {
        updateData.purchaseDate = new Date();
    }
    const updated = yield prisma_1.prisma.bikeAccessory.update({
        where: { id: accessory.id },
        data: updateData,
    });
    return {
        accessory: toApiShape(updated),
        justPurchased,
        bikeNickname: bike.nickname,
    };
});
const deleteBikeAccessoryFromDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const accessory = yield prisma_1.prisma.bikeAccessory.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!accessory) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike accessory not found");
    }
    const updated = yield prisma_1.prisma.bikeAccessory.update({
        where: { id: accessory.id },
        data: { isDeleted: true },
    });
    return toApiShape(updated);
});
const uploadBikeAccessoryImageIntoDB = (bikeId, userId, id, file) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    if (!file) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "Image file is required");
    }
    const accessory = yield prisma_1.prisma.bikeAccessory.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!accessory) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike accessory not found");
    }
    const existingProductImage = accessory.productImage;
    if (existingProductImage) {
        yield (0, cloudinary_1.deleteCloudinaryImage)(existingProductImage.publicId);
    }
    const updated = yield prisma_1.prisma.bikeAccessory.update({
        where: { id: accessory.id },
        data: { productImage: { url: file.path, publicId: file.filename } },
    });
    return toApiShape(updated);
});
const deleteBikeAccessoryImageFromDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const accessory = yield prisma_1.prisma.bikeAccessory.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!accessory) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Bike accessory not found");
    }
    const existingProductImage = accessory.productImage;
    if (!existingProductImage) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Product image not found");
    }
    yield (0, cloudinary_1.deleteCloudinaryImage)(existingProductImage.publicId);
    const updated = yield prisma_1.prisma.bikeAccessory.update({
        where: { id: accessory.id },
        data: { productImage: client_1.Prisma.JsonNull },
    });
    return toApiShape(updated);
});
exports.bikeAccessoryServices = {
    createBikeAccessoryIntoDB,
    getBikeAccessoriesFromDB,
    getBikeAccessoryByIdFromDB,
    updateBikeAccessoryInDB,
    deleteBikeAccessoryFromDB,
    uploadBikeAccessoryImageIntoDB,
    deleteBikeAccessoryImageFromDB,
};
