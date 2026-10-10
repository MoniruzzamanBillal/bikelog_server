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
// ! the odometer must be non-decreasing in DATE order across the bike's live fuel logs — NOT
// ! compared to bike.currentOdometer, which manual updates / maintenance logs can raise and
// ! nothing can lower (DEF-12), and which would also refuse legitimate backdated entries (spec 26).
// ! Same-timestamp ties count as "earlier", so entry order breaks the tie (spec 48)
const assertOdometerInSequence = (bike, entry) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const base = Object.assign({ bikeId: bike.id, isDeleted: false }, (entry.excludeId ? { id: { not: entry.excludeId } } : {}));
    const [earlier, later] = yield Promise.all([
        prisma_1.prisma.fuelLog.aggregate({
            where: Object.assign(Object.assign({}, base), { date: { lte: entry.date } }),
            _max: { odometerReading: true },
        }),
        prisma_1.prisma.fuelLog.aggregate({
            where: Object.assign(Object.assign({}, base), { date: { gt: entry.date } }),
            _min: { odometerReading: true },
        }),
    ]);
    const lowerBound = Math.max(bike.initialOdometer, (_a = earlier._max.odometerReading) !== null && _a !== void 0 ? _a : bike.initialOdometer);
    if (entry.reading < lowerBound) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, `Odometer reading (${entry.reading} km) can't be lower than the previous reading (${lowerBound} km)`);
    }
    const upperBound = later._min.odometerReading;
    if (upperBound !== null && entry.reading > upperBound) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, `Odometer reading (${entry.reading} km) can't be higher than a later fuel log's reading (${upperBound} km)`);
    }
});
const createFuelLogIntoDB = (bikeId, userId, payload) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const date = (_a = payload.date) !== null && _a !== void 0 ? _a : new Date();
    if (date < bike.purchaseDate) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, `Fuel log date cannot be before the bike's purchase date (${bike.purchaseDate.toISOString().split("T")[0]})`);
    }
    const odometerReading = payload.odometerReading;
    // ! validate and pre-compute the closure BEFORE the insert: a rejected request must leave no
    // ! orphan fuel log behind and must not bump the bike's odometer (spec 48 §D)
    yield assertOdometerInSequence(bike, { reading: odometerReading, date });
    let periodStartOdometer = bike.initialOdometer;
    let periodStartDate = null;
    let distanceKm = 0;
    if (payload.isFullTank) {
        const previousFullTank = yield prisma_1.prisma.fuelLog.findFirst({
            where: {
                bikeId,
                isFullTank: true,
                date: { lt: date },
                isDeleted: false,
            },
            orderBy: { date: "desc" },
        });
        if (previousFullTank) {
            periodStartOdometer = previousFullTank.odometerReading;
            periodStartDate = previousFullTank.date;
        }
        // ! else: no prior full-tank fill exists yet — anchor on the bike's immutable initial
        // ! odometer reading, NOT currentOdometer (which is bumped below and would always equal
        // ! this fuel log's own reading, collapsing distanceKm to 0)
        // ! no lower date bound either (periodStartDate stays null) — this is the bike's
        // ! first-ever closed period, so every fuel log dated on/before this fill belongs to it.
        // ! bike.createdAt (when the DB record was inserted) is NOT a valid anchor: backdating fuel
        // ! history right after creating a bike is a normal, supported flow, and a backdated log's
        // ! date is almost always before bike.createdAt, which used to invert this query's range
        // ! and silently zero out the whole period (see spec 26).
        distanceKm = odometerReading - periodStartOdometer;
        // ! unreachable while assertOdometerInSequence holds — guards against a negative-distance
        // ! mileage record ever being written again (DEF-04, spec 48)
        if (distanceKm < 0) {
            throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "Odometer reading is lower than the previous full-tank fill");
        }
    }
    const totalCost = ((_b = payload.litersAdded) !== null && _b !== void 0 ? _b : 0) * ((_c = payload.pricePerLiter) !== null && _c !== void 0 ? _c : 0);
    const fuelLog = yield prisma_1.prisma.fuelLog.create({
        data: {
            id: (0, generateObjectId_1.generateObjectId)(),
            bikeId,
            odometerReading,
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
    // ! a 0 km period (e.g. the first full-tank fill made exactly at the bike's initial odometer)
    // ! has no meaningful km/l — keep the fuel log as the baseline for the next period but write
    // ! no MileageRecord (spec 48 §C)
    if (fuelLog.isFullTank && distanceKm > 0) {
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
    var _a, _b, _c, _d;
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
    const fuelLog = yield prisma_1.prisma.fuelLog.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!fuelLog) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Fuel log not found");
    }
    // ! re-check the odometer ordering whenever the reading or the date moves; excludeId keeps a
    // ! log from conflicting with itself, so correcting a typo on the newest log still works (spec 48)
    if (payload.odometerReading !== undefined || payload.date !== undefined) {
        yield assertOdometerInSequence(bike, {
            reading: (_a = payload.odometerReading) !== null && _a !== void 0 ? _a : fuelLog.odometerReading,
            date: (_b = payload.date) !== null && _b !== void 0 ? _b : fuelLog.date,
            excludeId: id,
        });
    }
    // ! totalCost is always server-derived — never trust a client-submitted value directly
    delete payload.totalCost;
    const updateData = Object.assign({}, payload);
    if (payload.litersAdded !== undefined || payload.pricePerLiter !== undefined) {
        const newLiters = (_c = payload.litersAdded) !== null && _c !== void 0 ? _c : fuelLog.litersAdded;
        // ! fuelLog.pricePerLiter off a freshly-fetched Prisma row is a Prisma.Decimal
        // ! instance, not a plain number — multiplying it directly is unreliable, convert first
        const newPrice = (_d = payload.pricePerLiter) !== null && _d !== void 0 ? _d : Number(fuelLog.pricePerLiter);
        updateData.totalCost = newLiters * newPrice;
    }
    const updated = yield prisma_1.prisma.fuelLog.update({
        where: { id: fuelLog.id },
        data: updateData,
    });
    // ! keep bike.currentOdometer in step when an edit raises the reading (create already bumps);
    // ! a no-op when it was lowered — nothing rolls the odometer back (DEF-12, out of scope)
    if (payload.odometerReading !== undefined) {
        yield (0, bike_utils_1.bumpOdometerIfHigher)(bike, updated.odometerReading);
    }
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
