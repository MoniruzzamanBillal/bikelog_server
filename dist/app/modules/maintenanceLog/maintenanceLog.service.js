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
exports.maintenanceLogServices = void 0;
const client_1 = require("@prisma/client");
const http_status_1 = __importDefault(require("http-status"));
const AppError_1 = __importDefault(require("../../Error/AppError"));
const prisma_1 = require("../../lib/prisma");
const generateObjectId_1 = require("../../util/generateObjectId");
const buildPrismaListQuery_1 = require("../../builder/buildPrismaListQuery");
const bike_utils_1 = require("../bike/bike.utils");
const cloudinary_1 = require("../../util/cloudinary");
// ! Spec 41 §B: every read that returns a log populates its two catalog relations, so the
// ! display name travels with the log instead of being joined client-side against the
// ! catalog list. That join broke once the list endpoints started hiding soft-deleted rows
// ! (spec 41 §D) — a historical log's type would silently relabel to "Maintenance".
// ! Deliberately NO `isDeleted` filter here: a log must still resolve the name of a type
// ! that has since been deleted. That is the entire point of this include.
// !
// ! Spec 46 §D: and deliberately NO owner filter either — this is the tempting wrong move.
// ! After spec 46 a log's catalog rows are owner-coherent BY CONSTRUCTION (the write paths
// ! below only accept a type the bike's owner owns, and the backfill re-pointed every
// ! historical log to its owner's copy), so filtering here would add nothing and would
// ! re-break the exact bug spec 41 fixed. `getRemindersFromDB`'s non-optional
// ! `log.maintenanceType.name` stays safe for the same reason.
const catalogInclude = {
    maintenanceType: { select: { id: true, name: true } },
    oilType: { select: { id: true, name: true } },
};
// every returned maintenance log gets three FK renames (not just _id/bike — spec 34
// decision A) plus Decimal->Number conversion for cost
const toApiShape = (log) => (Object.assign(Object.assign({}, log), { _id: log.id, bike: log.bikeId, 
    // ! Populated when the caller passed `catalogInclude`; falls back to the bare id string
    // ! so an un-included read still returns the pre-spec-41 shape rather than undefined.
    // ! Both clients already accept either form (a surviving Mongoose-populate branch).
    maintenanceType: log.maintenanceType
        ? { _id: log.maintenanceType.id, name: log.maintenanceType.name }
        : log.maintenanceTypeId, 
    // ! `oilTypeId` stays `null` (not `undefined`) when absent — preserving the existing
    // ! wire contract exactly. `undefined` would drop the key from the JSON entirely.
    oilType: log.oilType
        ? { _id: log.oilType.id, name: log.oilType.name }
        : log.oilTypeId, cost: Number(log.cost) }));
const computeNextDueOdometer = (odometerReading, intervalKmUsed) => {
    return odometerReading + intervalKmUsed;
};
const createMaintenanceLogIntoDB = (bikeId, userId, payload) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    // ! Spec 41 §G: findFirst, not findUnique — `isDeleted` is not a unique field, so
    // ! findUnique will not accept it in `where`. A soft-deleted catalog row must be
    // ! unreachable to new writes, otherwise the FK succeeds and a log points at a type the
    // ! user can no longer see.
    // ! Spec 46 §D — THIS IS THE ACTUAL IDOR the spec fixes, not the list leak. Without
    // ! `ownerId: userId` a user could attach another user's catalog row to their own log
    // ! just by submitting its id. `userId` was already in scope here the whole time.
    const maintenanceType = yield prisma_1.prisma.maintenanceType.findFirst({
        where: { id: payload.maintenanceType, ownerId: userId, isDeleted: false },
    });
    if (!maintenanceType) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Maintenance type not found");
    }
    if (payload.oilType) {
        const oilType = yield prisma_1.prisma.engineOilType.findFirst({
            where: { id: payload.oilType, ownerId: userId, isDeleted: false },
        });
        if (!oilType) {
            throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Engine oil type not found");
        }
    }
    const nextDueOdometer = payload.intervalKmUsed !== undefined
        ? computeNextDueOdometer(payload.odometerReading, payload.intervalKmUsed)
        : undefined;
    const log = yield prisma_1.prisma.maintenanceLog.create({
        data: {
            id: (0, generateObjectId_1.generateObjectId)(),
            bikeId,
            maintenanceTypeId: payload.maintenanceType,
            oilTypeId: payload.oilType,
            odometerReading: payload.odometerReading,
            intervalKmUsed: payload.intervalKmUsed,
            nextDueOdometer,
            nextDueDate: payload.nextDueDate,
            cost: payload.cost,
            serviceDate: (_a = payload.serviceDate) !== null && _a !== void 0 ? _a : new Date(),
            serviceCenter: payload.serviceCenter,
            partsReplaced: (_b = payload.partsReplaced) !== null && _b !== void 0 ? _b : [],
            notes: payload.notes,
        },
        include: catalogInclude,
    });
    yield (0, bike_utils_1.bumpOdometerIfHigher)(bike, payload.odometerReading);
    return {
        log: toApiShape(log),
        maintenanceTypeName: maintenanceType.name,
        bikeNickname: bike.nickname,
    };
});
const getMaintenanceLogsFromDB = (bikeId, userId, query) => __awaiter(void 0, void 0, void 0, function* () {
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
        defaultSort: "-serviceDate",
    });
    const [result, meta] = yield Promise.all([
        prisma_1.prisma.maintenanceLog.findMany({
            where,
            orderBy,
            skip,
            take,
            include: catalogInclude,
        }),
        prisma_1.prisma.maintenanceLog.count({ where }),
    ]);
    return { result: result.map(toApiShape), meta };
});
const getMaintenanceLogByIdFromDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const log = yield prisma_1.prisma.maintenanceLog.findFirst({
        where: { id, bikeId, isDeleted: false },
        include: catalogInclude,
    });
    if (!log) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Maintenance log not found");
    }
    return toApiShape(log);
});
const updateMaintenanceLogInDB = (bikeId, userId, id, payload) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const log = yield prisma_1.prisma.maintenanceLog.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!log) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Maintenance log not found");
    }
    // ! Spec 46 §D: the update path is the second IDOR site and the easy one to miss —
    // ! re-assigning a log to another user's catalog row must 404 exactly as creating one does.
    if (payload.maintenanceType) {
        const maintenanceType = yield prisma_1.prisma.maintenanceType.findFirst({
            where: { id: payload.maintenanceType, ownerId: userId, isDeleted: false },
        });
        if (!maintenanceType) {
            throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Maintenance type not found");
        }
    }
    if (payload.oilType) {
        const oilType = yield prisma_1.prisma.engineOilType.findFirst({
            where: { id: payload.oilType, ownerId: userId, isDeleted: false },
        });
        if (!oilType) {
            throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Engine oil type not found");
        }
    }
    const updateData = Object.assign({}, payload);
    delete updateData.nextDueOdometer;
    // ! client sends maintenanceType/oilType (plain id strings) — the Prisma column
    // ! names are maintenanceTypeId/oilTypeId, remap before handing off to update()
    if ("maintenanceType" in updateData) {
        updateData.maintenanceTypeId = updateData.maintenanceType;
        delete updateData.maintenanceType;
    }
    if ("oilType" in updateData) {
        updateData.oilTypeId = updateData.oilType;
        delete updateData.oilType;
    }
    const newOdometer = (_a = payload.odometerReading) !== null && _a !== void 0 ? _a : log.odometerReading;
    const newInterval = (_c = (_b = payload.intervalKmUsed) !== null && _b !== void 0 ? _b : log.intervalKmUsed) !== null && _c !== void 0 ? _c : undefined;
    if ((payload.odometerReading !== undefined || payload.intervalKmUsed !== undefined) &&
        newInterval !== undefined) {
        updateData.nextDueOdometer = computeNextDueOdometer(newOdometer, newInterval);
    }
    const updated = yield prisma_1.prisma.maintenanceLog.update({
        where: { id: log.id },
        data: updateData,
        include: catalogInclude,
    });
    // ! create bumps the bike odometer; an edit that raises the reading must too, or
    // ! currentOdometer ends up below the highest logged reading with no race involved (spec 49 §C).
    // ! Atomic and a no-op when the reading was lowered — nothing rolls the odometer back
    if (payload.odometerReading !== undefined) {
        yield (0, bike_utils_1.bumpOdometerIfHigher)(bike, updated.odometerReading);
    }
    return toApiShape(updated);
});
const deleteMaintenanceLogFromDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const log = yield prisma_1.prisma.maintenanceLog.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!log) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Maintenance log not found");
    }
    const updated = yield prisma_1.prisma.maintenanceLog.update({
        where: { id: log.id },
        data: { isDeleted: true },
        include: catalogInclude,
    });
    return toApiShape(updated);
});
const getRemindersFromDB = (bikeId, userId) => __awaiter(void 0, void 0, void 0, function* () {
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const logs = yield prisma_1.prisma.maintenanceLog.findMany({
        where: { bikeId, isDeleted: false },
        orderBy: { serviceDate: "desc" },
        include: catalogInclude,
    });
    // ! log.maintenanceTypeId is already a plain string off a Prisma row — no .toString()
    // ! coercion needed (that was only ever undoing a Mongoose ObjectId)
    const latestPerType = new Map();
    for (const log of logs) {
        const key = log.maintenanceTypeId;
        if (!latestPerType.has(key)) {
            latestPerType.set(key, log);
        }
    }
    const reminders = [];
    for (const [, log] of latestPerType) {
        let status = null;
        let kmRemaining;
        if (log.nextDueOdometer !== null) {
            kmRemaining = log.nextDueOdometer - bike.currentOdometer;
            const kmOverdue = kmRemaining <= 0;
            const kmUpcoming = !kmOverdue && kmRemaining <= 50;
            if (kmOverdue) {
                status = "overdue";
            }
            else if (kmUpcoming) {
                status = "upcoming";
            }
        }
        let daysRemaining;
        if (log.nextDueDate) {
            const msRemaining = log.nextDueDate.getTime() - Date.now();
            daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
            const dateOverdue = msRemaining <= 0;
            const dateUpcoming = !dateOverdue && daysRemaining <= 14;
            if (dateOverdue) {
                status = "overdue";
            }
            else if (dateUpcoming && !status) {
                status = "upcoming";
            }
        }
        if (status) {
            const reminder = {
                maintenanceType: {
                    _id: log.maintenanceTypeId,
                    name: log.maintenanceType.name,
                },
                lastServiceDate: log.serviceDate,
                lastOdometerReading: log.odometerReading,
                status,
            };
            if (log.nextDueOdometer !== null) {
                reminder.nextDueOdometer = log.nextDueOdometer;
                reminder.kmRemaining = Math.max(0, kmRemaining);
            }
            if (log.nextDueDate) {
                reminder.nextDueDate = log.nextDueDate;
                reminder.daysRemaining = daysRemaining;
            }
            reminders.push(reminder);
        }
    }
    return { reminders };
});
const uploadMaintenanceLogImageIntoDB = (bikeId, userId, id, file) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    if (!file) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "Image file is required");
    }
    const log = yield prisma_1.prisma.maintenanceLog.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!log) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Maintenance log not found");
    }
    const existingServiceImage = log.serviceImage;
    if (existingServiceImage) {
        yield (0, cloudinary_1.deleteCloudinaryImage)(existingServiceImage.publicId);
    }
    const updated = yield prisma_1.prisma.maintenanceLog.update({
        where: { id: log.id },
        data: { serviceImage: { url: file.path, publicId: file.filename } },
        include: catalogInclude,
    });
    return toApiShape(updated);
});
const deleteMaintenanceLogImageFromDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const log = yield prisma_1.prisma.maintenanceLog.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!log) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Maintenance log not found");
    }
    const existingServiceImage = log.serviceImage;
    if (!existingServiceImage) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Service image not found");
    }
    yield (0, cloudinary_1.deleteCloudinaryImage)(existingServiceImage.publicId);
    const updated = yield prisma_1.prisma.maintenanceLog.update({
        where: { id: log.id },
        data: { serviceImage: client_1.Prisma.JsonNull },
        include: catalogInclude,
    });
    return toApiShape(updated);
});
exports.maintenanceLogServices = {
    createMaintenanceLogIntoDB,
    getMaintenanceLogsFromDB,
    getMaintenanceLogByIdFromDB,
    updateMaintenanceLogInDB,
    deleteMaintenanceLogFromDB,
    getRemindersFromDB,
    uploadMaintenanceLogImageIntoDB,
    deleteMaintenanceLogImageFromDB,
};
