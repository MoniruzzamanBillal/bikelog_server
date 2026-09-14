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
exports.fuelLogServices = void 0;
const client_1 = require("@prisma/client");
const http_status_1 = __importDefault(require("http-status"));
const AppError_1 = __importDefault(require("../../Error/AppError"));
const prisma_1 = require("../../lib/prisma");
const generateObjectId_1 = require("../../util/generateObjectId");
const buildPrismaListQuery_1 = require("../../builder/buildPrismaListQuery");
const bike_utils_1 = require("../bike/bike.utils");
const cloudinary_1 = require("../../util/cloudinary");
// every returned fuel log gets the _id/bike remap (spec 31/32 precedent) plus
// Decimal->Number conversion for pricePerLiter/totalCost (top-level plan decision #6)
const toApiShape = (fuelLog) => (Object.assign(Object.assign({}, fuelLog), { _id: fuelLog.id, bike: fuelLog.bikeId, pricePerLiter: Number(fuelLog.pricePerLiter), totalCost: Number(fuelLog.totalCost) }));
const createFuelLogIntoDB = (bikeId, userId, payload) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const date = (_a = payload.date) !== null && _a !== void 0 ? _a : new Date();
    if (date < bike.purchaseDate) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, `Fuel log date cannot be before the bike's purchase date (${bike.purchaseDate.toISOString().split("T")[0]})`);
    }
    const totalCost = ((_b = payload.litersAdded) !== null && _b !== void 0 ? _b : 0) * ((_c = payload.pricePerLiter) !== null && _c !== void 0 ? _c : 0);
    const fuelLog = yield prisma_1.prisma.fuelLog.create({
        data: {
            id: (0, generateObjectId_1.generateObjectId)(),
            bikeId,
            odometerReading: payload.odometerReading,
            litersAdded: payload.litersAdded,
            isFullTank: payload.isFullTank,
            pricePerLiter: payload.pricePerLiter,
            totalCost,
            fuelStation: payload.fuelStation,
            date,
            notes: payload.notes,
        },
    });
    yield (0, bike_utils_1.bumpOdometerIfHigher)(bike, fuelLog.odometerReading);
    let mileageRecordClosed = null;
    if (fuelLog.isFullTank) {
        const previousFullTank = yield prisma_1.prisma.fuelLog.findFirst({
            where: {
                bikeId,
                isFullTank: true,
                date: { lt: fuelLog.date },
                isDeleted: false,
            },
            orderBy: { date: "desc" },
        });
        let periodStartOdometer;
        let periodStartDate;
        if (previousFullTank) {
            periodStartOdometer = previousFullTank.odometerReading;
            periodStartDate = previousFullTank.date;
        }
        else {
            // ! no prior full-tank fill exists yet — anchor on the bike's immutable initial
            // ! odometer reading, NOT currentOdometer (which was just bumped above and would
            // ! always equal this fuel log's own reading, collapsing distanceKm to 0)
            periodStartOdometer = bike.initialOdometer;
            // ! no lower date bound — this is the bike's first-ever closed period, so every
            // ! fuel log dated on/before this fill belongs to it. bike.createdAt (when the DB
            // ! record was inserted) is NOT a valid anchor: backdating fuel history right after
            // ! creating a bike is a normal, supported flow, and a backdated log's date is
            // ! almost always before bike.createdAt, which used to invert this query's range
            // ! and silently zero out the whole period (see spec 26).
            periodStartDate = null;
        }
        const periodFuelLogs = yield prisma_1.prisma.fuelLog.findMany({
            where: {
                bikeId,
                // ! gt, not gte — periodStartDate is the PREVIOUS closing full-tank fill's date;
                // ! its liters already belong to the prior period and must not be double-counted here
                date: periodStartDate
                    ? { gt: periodStartDate, lte: fuelLog.date }
                    : { lte: fuelLog.date },
                isDeleted: false,
            },
            orderBy: { date: "asc" },
        });
        const litersConsumed = periodFuelLogs.reduce((sum, log) => sum + log.litersAdded, 0);
        const distanceKm = fuelLog.odometerReading - periodStartOdometer;
        const mileageKmPerLiter = litersConsumed > 0 ? distanceKm / litersConsumed : 0;
        const fuelLogIds = periodFuelLogs.map((log) => log.id);
        // ! for the first-ever period, derive the displayed start from the earliest fuel log
        // ! actually in it — reflects real fuel-log history instead of the bike's own creation
        // ! moment. periodFuelLogs[0] can't actually be undefined here (the just-created
        // ! fuelLog always satisfies its own lte bound), the createdAt fallback is defensive only.
        const resolvedPeriodStartDate = (_e = periodStartDate !== null && periodStartDate !== void 0 ? periodStartDate : (_d = periodFuelLogs[0]) === null || _d === void 0 ? void 0 : _d.date) !== null && _e !== void 0 ? _e : bike.createdAt;
        mileageRecordClosed = yield prisma_1.prisma.mileageRecord.create({
            data: {
                id: (0, generateObjectId_1.generateObjectId)(),
                bikeId,
                startOdometer: periodStartOdometer,
                endOdometer: fuelLog.odometerReading,
                distanceKm,
                litersConsumed,
                mileageKmPerLiter,
                periodStartDate: resolvedPeriodStartDate,
                periodEndDate: fuelLog.date,
                fuelLogIds,
            },
        });
    }
    return {
        fuelLog: toApiShape(fuelLog),
        // ! both clients require TMileageRecordClosed.bike: string alongside _id (spec 33 decision A)
        mileageRecordClosed: mileageRecordClosed
            ? Object.assign(Object.assign({}, mileageRecordClosed), { _id: mileageRecordClosed.id, bike: mileageRecordClosed.bikeId }) : null,
        bikeNickname: bike.nickname,
    };
});
const getFuelLogsFromDB = (bikeId, userId, query) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    // ! strip client-controlled "bike"/"isDeleted" keys before they reach buildPrismaListQuery —
    // ! it merges whatever's left in query as equality filters, and an unsanitized `?bike=<otherBikeId>`
    // ! would silently override the ownership-scoped filter below
    const sanitizedQuery = Object.assign({}, query);
    delete sanitizedQuery.bike;
    delete sanitizedQuery.isDeleted;
    const { where, orderBy, skip, take } = (0, buildPrismaListQuery_1.buildPrismaListQuery)({
        baseWhere: { bikeId, isDeleted: false },
        query: sanitizedQuery,
        defaultSort: "-date",
    });
    const [result, meta] = yield Promise.all([
        prisma_1.prisma.fuelLog.findMany({ where, orderBy, skip, take }),
        prisma_1.prisma.fuelLog.count({ where }),
    ]);
    return { result: result.map(toApiShape), meta };
});
const getFuelLogByIdFromDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const fuelLog = yield prisma_1.prisma.fuelLog.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!fuelLog) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Fuel log not found");
    }
    return toApiShape(fuelLog);
});
const updateFuelLogInDB = (bikeId, userId, id, payload) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    if (payload.date && payload.date < bike.purchaseDate) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, `Fuel log date cannot be before the bike's purchase date (${bike.purchaseDate.toISOString().split("T")[0]})`);
    }
    const isLocked = yield prisma_1.prisma.mileageRecord.findFirst({
        where: { fuelLogIds: { has: id } },
    });
    if (isLocked) {
        throw new AppError_1.default(http_status_1.default.CONFLICT, "This fuel log is part of a closed mileage record and can't be edited");
    }
    // ! totalCost is always server-derived — never trust a client-submitted value directly
    delete payload.totalCost;
    const updateData = Object.assign({}, payload);
    if (payload.litersAdded !== undefined || payload.pricePerLiter !== undefined) {
        const existing = yield prisma_1.prisma.fuelLog.findFirst({
            where: { id, bikeId },
        });
        if (existing) {
            const newLiters = (_a = payload.litersAdded) !== null && _a !== void 0 ? _a : existing.litersAdded;
            // ! existing.pricePerLiter off a freshly-fetched Prisma row is a Prisma.Decimal
            // ! instance, not a plain number — multiplying it directly is unreliable, convert first
            const newPrice = (_b = payload.pricePerLiter) !== null && _b !== void 0 ? _b : Number(existing.pricePerLiter);
            updateData.totalCost = newLiters * newPrice;
        }
    }
    const fuelLog = yield prisma_1.prisma.fuelLog.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!fuelLog) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Fuel log not found");
    }
    const updated = yield prisma_1.prisma.fuelLog.update({
        where: { id: fuelLog.id },
        data: updateData,
    });
    return toApiShape(updated);
});
const deleteFuelLogFromDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const isLocked = yield prisma_1.prisma.mileageRecord.findFirst({
        where: { fuelLogIds: { has: id } },
    });
    if (isLocked) {
        throw new AppError_1.default(http_status_1.default.CONFLICT, "This fuel log is part of a closed mileage record and can't be deleted");
    }
    const fuelLog = yield prisma_1.prisma.fuelLog.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!fuelLog) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Fuel log not found");
    }
    const updated = yield prisma_1.prisma.fuelLog.update({
        where: { id: fuelLog.id },
        data: { isDeleted: true },
    });
    return toApiShape(updated);
});
const uploadFuelLogImageIntoDB = (bikeId, userId, id, file) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    if (!file) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "Image file is required");
    }
    const fuelLog = yield prisma_1.prisma.fuelLog.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!fuelLog) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Fuel log not found");
    }
    const existingReceiptImage = fuelLog.receiptImage;
    if (existingReceiptImage) {
        yield (0, cloudinary_1.deleteCloudinaryImage)(existingReceiptImage.publicId);
    }
    const updated = yield prisma_1.prisma.fuelLog.update({
        where: { id: fuelLog.id },
        data: { receiptImage: { url: file.path, publicId: file.filename } },
    });
    return toApiShape(updated);
});
const deleteFuelLogImageFromDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const fuelLog = yield prisma_1.prisma.fuelLog.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!fuelLog) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Fuel log not found");
    }
    const existingReceiptImage = fuelLog.receiptImage;
    if (!existingReceiptImage) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Receipt image not found");
    }
    yield (0, cloudinary_1.deleteCloudinaryImage)(existingReceiptImage.publicId);
    const updated = yield prisma_1.prisma.fuelLog.update({
        where: { id: fuelLog.id },
        data: { receiptImage: client_1.Prisma.JsonNull },
    });
    return toApiShape(updated);
});
exports.fuelLogServices = {
    createFuelLogIntoDB,
    getFuelLogsFromDB,
    getFuelLogByIdFromDB,
    updateFuelLogInDB,
    deleteFuelLogFromDB,
    uploadFuelLogImageIntoDB,
    deleteFuelLogImageFromDB,
};
