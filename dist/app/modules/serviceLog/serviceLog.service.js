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
exports.serviceLogServices = void 0;
const client_1 = require("@prisma/client");
const http_status_1 = __importDefault(require("http-status"));
const AppError_1 = __importDefault(require("../../Error/AppError"));
const prisma_1 = require("../../lib/prisma");
const generateObjectId_1 = require("../../util/generateObjectId");
const buildPrismaListQuery_1 = require("../../builder/buildPrismaListQuery");
const cloudinary_1 = require("../../util/cloudinary");
const bike_utils_1 = require("../bike/bike.utils");
const serviceLog_utils_1 = require("./serviceLog.utils");
// ! Normalize before store: item costs rounded to 2dp (JSON numbers, not Decimal), every
// ! entry given a stable id. A zero/absent cost becomes 0, never NaN.
const toStorableItems = (items) => (items !== null && items !== void 0 ? items : []).map((item) => {
    var _a;
    return ({
        id: (_a = item === null || item === void 0 ? void 0 : item.id) !== null && _a !== void 0 ? _a : (0, generateObjectId_1.generateObjectId)(),
        name: item.name,
        cost: Number.isFinite(Number(item === null || item === void 0 ? void 0 : item.cost)) ? (0, serviceLog_utils_1.round2)(Number(item.cost)) : 0,
    });
});
// ! `targetDate` is serialized to an ISO string — a JSON column cannot hold a Date, and the
// ! reminder builder reads it back with `new Date(...)`. `done` defaults to false.
const toStorableRecommendations = (recs) => (recs !== null && recs !== void 0 ? recs : []).map((rec) => {
    var _a, _b;
    return ({
        id: (_a = rec === null || rec === void 0 ? void 0 : rec.id) !== null && _a !== void 0 ? _a : (0, generateObjectId_1.generateObjectId)(),
        text: rec.text,
        targetDate: (rec === null || rec === void 0 ? void 0 : rec.targetDate) ? new Date(rec.targetDate).toISOString() : null,
        targetOdometer: (rec === null || rec === void 0 ? void 0 : rec.targetOdometer) != null ? Number(rec.targetOdometer) : null,
        done: (_b = rec === null || rec === void 0 ? void 0 : rec.done) !== null && _b !== void 0 ? _b : false,
    });
});
// mirrors engineOilLog's toApiShape: the _id/bike remap. Item costs are already Numbers in
// the JSON, but re-coerced defensively so a hand-tampered row can never leak a Decimal-like
// string into a client's arithmetic.
const toApiShape = (log) => {
    var _a, _b;
    const items = ((_a = log.items) !== null && _a !== void 0 ? _a : []).map((i) => {
        var _a;
        return (Object.assign(Object.assign({}, i), { cost: Number((_a = i === null || i === void 0 ? void 0 : i.cost) !== null && _a !== void 0 ? _a : 0) }));
    });
    return Object.assign(Object.assign({}, log), { _id: log.id, bike: log.bikeId, items, recommendations: (_b = log.recommendations) !== null && _b !== void 0 ? _b : [] });
};
const createServiceLogIntoDB = (bikeId, userId, payload) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g;
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const serviceKind = (_a = payload.serviceKind) !== null && _a !== void 0 ? _a : "regular";
    const status = (0, serviceLog_utils_1.deriveStatus)(payload.serviceDate);
    // ! auto-assign the warranty number only for a warranty service that omits it — one past
    // ! however many warranty rows already exist (spec 67). A regular service never gets one.
    let warrantyNumber = null;
    if (serviceKind === "warranty") {
        if (payload.warrantyNumber != null) {
            warrantyNumber = payload.warrantyNumber;
        }
        else {
            const existing = yield prisma_1.prisma.serviceLog.count({
                where: { bikeId, isDeleted: false, serviceKind: "warranty" },
            });
            warrantyNumber = (0, serviceLog_utils_1.nextWarrantyNumber)(existing);
        }
    }
    const log = yield prisma_1.prisma.serviceLog.create({
        data: {
            id: (0, generateObjectId_1.generateObjectId)(),
            bikeId,
            serviceKind,
            warrantyNumber,
            status,
            dueDate: (_b = payload.dueDate) !== null && _b !== void 0 ? _b : null,
            serviceDate: (_c = payload.serviceDate) !== null && _c !== void 0 ? _c : null,
            odometerReading: (_d = payload.odometerReading) !== null && _d !== void 0 ? _d : null,
            serviceCenter: (_e = payload.serviceCenter) !== null && _e !== void 0 ? _e : null,
            centerType: (_f = payload.centerType) !== null && _f !== void 0 ? _f : null,
            items: toStorableItems(payload.items),
            recommendations: toStorableRecommendations(payload.recommendations),
            notes: (_g = payload.notes) !== null && _g !== void 0 ? _g : null,
        },
    });
    // ! a completed service with a reading can only move the odometer forward (atomic
    // ! conditional write, specs 45/49) — a scheduled/upcoming service carries no reading.
    if (status === "completed" && payload.odometerReading != null) {
        yield (0, bike_utils_1.bumpOdometerIfHigher)(bike, payload.odometerReading);
    }
    const itemTotal = (0, serviceLog_utils_1.sumItemCosts)(payload.items);
    return {
        log: toApiShape(log),
        bikeNickname: bike.nickname,
        // ! the controller fires the expense push exactly when a service first becomes
        // ! completed AND carries a cost — a free or still-scheduled service pushes nothing.
        justCompleted: status === "completed",
        itemTotal,
    };
});
const getServiceLogsFromDB = (bikeId, userId, query) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    // ! strip client-controlled "bike"/"isDeleted" before buildPrismaListQuery merges leftover
    // ! keys as equality filters — an `?bike=<otherId>` would otherwise override the scope.
    const sanitizedQuery = Object.assign({}, query);
    delete sanitizedQuery.bike;
    delete sanitizedQuery.isDeleted;
    const { where, orderBy, skip, take } = (0, buildPrismaListQuery_1.buildPrismaListQuery)({
        baseWhere: { bikeId, isDeleted: false },
        query: sanitizedQuery,
        defaultSort: "-serviceDate",
    });
    const [result, meta] = yield Promise.all([
        prisma_1.prisma.serviceLog.findMany({ where, orderBy, skip, take }),
        prisma_1.prisma.serviceLog.count({ where }),
    ]);
    return { result: result.map(toApiShape), meta };
});
const getServiceLogByIdFromDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const log = yield prisma_1.prisma.serviceLog.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!log) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Service log not found");
    }
    return toApiShape(log);
});
const updateServiceLogInDB = (bikeId, userId, id, payload) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const existing = yield prisma_1.prisma.serviceLog.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!existing) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Service log not found");
    }
    const updateData = {};
    if (payload.serviceKind !== undefined)
        updateData.serviceKind = payload.serviceKind;
    if (payload.warrantyNumber !== undefined)
        updateData.warrantyNumber = payload.warrantyNumber;
    if (payload.dueDate !== undefined)
        updateData.dueDate = payload.dueDate;
    if (payload.serviceDate !== undefined)
        updateData.serviceDate = payload.serviceDate;
    if (payload.odometerReading !== undefined)
        updateData.odometerReading = payload.odometerReading;
    if (payload.serviceCenter !== undefined)
        updateData.serviceCenter = payload.serviceCenter;
    if (payload.centerType !== undefined)
        updateData.centerType = payload.centerType;
    if (payload.notes !== undefined)
        updateData.notes = payload.notes;
    if (payload.items !== undefined)
        updateData.items = toStorableItems(payload.items);
    if (payload.recommendations !== undefined)
        updateData.recommendations = toStorableRecommendations(payload.recommendations);
    // ! re-derive status whenever serviceDate moves (set → completed, cleared → upcoming);
    // ! a payload that doesn't touch serviceDate leaves status as it was.
    const effectiveServiceDate = payload.serviceDate !== undefined
        ? payload.serviceDate
        : existing.serviceDate;
    const newStatus = (0, serviceLog_utils_1.deriveStatus)(effectiveServiceDate);
    updateData.status = newStatus;
    const updated = yield prisma_1.prisma.serviceLog.update({
        where: { id: existing.id },
        data: updateData,
    });
    if (updated.status === "completed" && updated.odometerReading != null) {
        yield (0, bike_utils_1.bumpOdometerIfHigher)(bike, updated.odometerReading);
    }
    // ! fire the expense push only on the upcoming → completed TRANSITION, so editing an
    // ! already-completed service does not re-push. expenseTracker2 also dedupes on
    // ! sourceRecordId (the service id), but the transition gate keeps it clean at the source.
    const justCompleted = existing.status !== "completed" && updated.status === "completed";
    const itemTotal = (0, serviceLog_utils_1.sumItemCosts)((_a = updated.items) !== null && _a !== void 0 ? _a : undefined);
    return {
        log: toApiShape(updated),
        bikeNickname: bike.nickname,
        justCompleted,
        itemTotal,
    };
});
const deleteServiceLogFromDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const log = yield prisma_1.prisma.serviceLog.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!log) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Service log not found");
    }
    const updated = yield prisma_1.prisma.serviceLog.update({
        where: { id: log.id },
        data: { isDeleted: true },
    });
    return toApiShape(updated);
});
// GET /status — warranty progress. Derived live from every non-deleted service row; nothing
// is stored, so a service logged or completed moments ago is reflected on the next request.
const getServiceStatusFromDB = (bikeId, userId) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const rows = yield prisma_1.prisma.serviceLog.findMany({
        where: { bikeId, isDeleted: false },
        select: {
            serviceKind: true,
            status: true,
            warrantyNumber: true,
            dueDate: true,
        },
    });
    return (0, serviceLog_utils_1.summarizeWarranty)(rows, new Date());
});
const uploadServiceLogImageIntoDB = (bikeId, userId, id, file) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    if (!file) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "Image file is required");
    }
    const log = yield prisma_1.prisma.serviceLog.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!log) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Service log not found");
    }
    const existingImage = log.serviceImage;
    if (existingImage) {
        yield (0, cloudinary_1.deleteCloudinaryImage)(existingImage.publicId);
    }
    const updated = yield prisma_1.prisma.serviceLog.update({
        where: { id: log.id },
        data: { serviceImage: { url: file.path, publicId: file.filename } },
    });
    return toApiShape(updated);
});
const deleteServiceLogImageFromDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const log = yield prisma_1.prisma.serviceLog.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!log) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Service log not found");
    }
    const existingImage = log.serviceImage;
    if (!existingImage) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Receipt image not found");
    }
    yield (0, cloudinary_1.deleteCloudinaryImage)(existingImage.publicId);
    const updated = yield prisma_1.prisma.serviceLog.update({
        where: { id: log.id },
        data: { serviceImage: client_1.Prisma.JsonNull },
    });
    return toApiShape(updated);
});
exports.serviceLogServices = {
    createServiceLogIntoDB,
    getServiceLogsFromDB,
    getServiceLogByIdFromDB,
    updateServiceLogInDB,
    deleteServiceLogFromDB,
    getServiceStatusFromDB,
    uploadServiceLogImageIntoDB,
    deleteServiceLogImageFromDB,
};
