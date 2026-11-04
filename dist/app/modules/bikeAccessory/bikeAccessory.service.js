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
// ! month-based spending summary for the app's accessories "Purchased" tab (spec 59):
// ! all-time total, current-month total, and a per-month breakdown (newest-first) that
// ! includes every month from the earliest purchase to the current one — empty in-between
// ! months (and an empty current month) are returned with total 0 so the client can render
// ! the gaps without re-deriving the calendar itself.
const getAccessorySpendingSummaryFromDB = (bikeId, userId) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    // ! only purchased, non-deleted accessories count as real spending — same filter the
    // ! spending module uses (pending/cancelled wishlist entries are never money spent)
    const purchased = yield prisma_1.prisma.bikeAccessory.findMany({
        where: { bikeId, isDeleted: false, status: bikeAccessory_constant_1.AccessoryStatus.purchased },
        orderBy: { purchaseDate: "desc" },
    });
    // ! "YYYY-MM" in server-local time — same month-boundary convention as
    // ! resolveSpendingDateRange in spending.service.ts (date-fns is not a server dependency)
    const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const now = new Date();
    const currentMonth = monthKey(now);
    const buckets = new Map();
    let allTimeTotal = 0;
    let earliest = null;
    for (const accessory of purchased) {
        // purchaseDate is always stamped on the purchase transition; createdAt is a defensive fallback
        const when = (_a = accessory.purchaseDate) !== null && _a !== void 0 ? _a : accessory.createdAt;
        const key = monthKey(when);
        const price = accessory.price !== null ? Number(accessory.price) : 0;
        allTimeTotal += price;
        let bucket = buckets.get(key);
        if (!bucket) {
            bucket = { total: 0, accessories: [] };
            buckets.set(key, bucket);
        }
        bucket.total += price;
        bucket.accessories.push(toApiShape(accessory));
        if (!earliest || when < earliest) {
            earliest = when;
        }
    }
    const currentMonthTotal = (_c = (_b = buckets.get(currentMonth)) === null || _b === void 0 ? void 0 : _b.total) !== null && _c !== void 0 ? _c : 0;
    const months = [];
    // ! no purchases at all → empty list; the client shows its "wishlist is empty" state
    if (earliest) {
        const rangeStart = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
        // walk backwards month-by-month from the current month to the earliest, so the
        // result is newest-first and every month in between is represented
        const cursor = new Date(now.getFullYear(), now.getMonth(), 1);
        while (cursor >= rangeStart) {
            const key = monthKey(cursor);
            const bucket = buckets.get(key);
            months.push({
                month: key,
                total: (_d = bucket === null || bucket === void 0 ? void 0 : bucket.total) !== null && _d !== void 0 ? _d : 0,
                accessories: (_e = bucket === null || bucket === void 0 ? void 0 : bucket.accessories) !== null && _e !== void 0 ? _e : [],
            });
            cursor.setMonth(cursor.getMonth() - 1);
        }
    }
    return { allTimeTotal, currentMonth, currentMonthTotal, months };
});
exports.bikeAccessoryServices = {
    createBikeAccessoryIntoDB,
    getAccessorySpendingSummaryFromDB,
    getBikeAccessoriesFromDB,
    getBikeAccessoryByIdFromDB,
    updateBikeAccessoryInDB,
    deleteBikeAccessoryFromDB,
    uploadBikeAccessoryImageIntoDB,
    deleteBikeAccessoryImageFromDB,
};
