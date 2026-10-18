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
exports.engineOilLogServices = void 0;
const client_1 = require("@prisma/client");
const http_status_1 = __importDefault(require("http-status"));
const AppError_1 = __importDefault(require("../../Error/AppError"));
const prisma_1 = require("../../lib/prisma");
const generateObjectId_1 = require("../../util/generateObjectId");
const buildPrismaListQuery_1 = require("../../builder/buildPrismaListQuery");
const cloudinary_1 = require("../../util/cloudinary");
const ridingRate_1 = require("../../util/ridingRate");
const bike_utils_1 = require("../bike/bike.utils");
const engineOilType_utils_1 = require("../engineOilType/engineOilType.utils");
const engineOilLog_utils_1 = require("./engineOilLog.utils");
// ! Deliberately NO `isDeleted` filter on this include — spec 41's rule, same as
// ! maintenanceLog's `catalogInclude`: a historical log must still resolve the name of a
// ! type that has since been soft-deleted. No owner filter either: both write paths below
// ! only accept a type the bike's owner owns, so a log's oil type is owner-coherent by
// ! construction (spec 46 §D).
const oilTypeInclude = {
    oilType: { select: { id: true, name: true } },
};
// mirrors fuelLog.service.ts's: the _id/bike remap plus Decimal->Number for cost, and the
// catalog relation populated as { _id, name } when it was included
const toApiShape = (log) => (Object.assign(Object.assign({}, log), { _id: log.id, bike: log.bikeId, 
    // ! falls back to the bare id string when the caller did not include the relation, the
    // ! same two-shape contract maintenanceLog already has
    oilType: log.oilType
        ? { _id: log.oilType.id, name: log.oilType.name }
        : log.oilTypeId, cost: Number(log.cost) }));
// ! mirrors fuelLog/maintenanceLog: an oil change can't predate owning the bike (spec 50 §4)
const assertNotBeforePurchase = (changeDate, purchaseDate) => {
    if (changeDate < purchaseDate) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, `Engine oil change date cannot be before the bike's purchase date (${purchaseDate.toISOString().split("T")[0]})`);
    }
};
// ! §C: the ORDER of these steps is the point — nothing is written until every check has
// ! passed, so a rejected request leaves no orphan row behind and does not bump the bike's
// ! odometer (spec 48 §D).
const createEngineOilLogIntoDB = (bikeId, userId, payload) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const changeDate = (_a = payload.changeDate) !== null && _a !== void 0 ? _a : new Date();
    assertNotBeforePurchase(changeDate, bike.purchaseDate);
    // ! 404 on another user's id, not 403 — this repo's convention (spec 46 §E). Must happen
    // ! on BOTH create and update; spec 46 §D records the update path as the IDOR site people miss.
    const oilType = yield (0, engineOilType_utils_1.findOwnedEngineOilTypeOrThrow)(payload.oilType, userId);
    const odometerReading = payload.odometerReading;
    yield (0, engineOilLog_utils_1.assertOilOdometerInSequence)(bike, {
        reading: odometerReading,
        date: changeDate,
    });
    // ! D3: the client normally sends `intervalKmUsed`, pre-filled from the oil type and
    // ! editable by the rider. This `??` is the safety net for callers that omit it (the
    // ! import, Postman, bikelog_app before its half ships) — not the main path. Resolved
    // ! once, here, and then frozen on the row: reading the catalog live on every status
    // ! request would let a catalog edit retroactively move a past change's due point (H6).
    const intervalKmUsed = (_b = payload.intervalKmUsed) !== null && _b !== void 0 ? _b : oilType.suggestedIntervalKm;
    const nextDueOdometer = intervalKmUsed !== undefined && intervalKmUsed !== null
        ? (0, engineOilLog_utils_1.computeNextDueOdometer)(odometerReading, intervalKmUsed)
        : undefined;
    const log = yield prisma_1.prisma.engineOilLog.create({
        data: {
            id: (0, generateObjectId_1.generateObjectId)(),
            bikeId,
            oilTypeId: oilType.id,
            odometerReading,
            intervalKmUsed,
            nextDueOdometer,
            quantityLiters: payload.quantityLiters,
            oilFilterChanged: (_c = payload.oilFilterChanged) !== null && _c !== void 0 ? _c : false,
            cost: payload.cost,
            changeDate,
            serviceCenter: payload.serviceCenter,
            notes: payload.notes,
        },
        include: oilTypeInclude,
    });
    // ! the atomic conditional write from specs 45/49 — a no-op when the reading is lower
    yield (0, bike_utils_1.bumpOdometerIfHigher)(bike, odometerReading);
    return {
        log: toApiShape(log),
        oilTypeName: oilType.name,
        bikeNickname: bike.nickname,
    };
});
const getEngineOilLogsFromDB = (bikeId, userId, query) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    // ! strip client-controlled "bike"/"isDeleted" keys before they reach
    // ! buildPrismaListQuery — it merges whatever is left in `query` as equality filters, so
    // ! an unsanitized `?bike=<otherBikeId>` would override the ownership-scoped filter below
    const sanitizedQuery = Object.assign({}, query);
    delete sanitizedQuery.bike;
    delete sanitizedQuery.isDeleted;
    const { where, orderBy, skip, take } = (0, buildPrismaListQuery_1.buildPrismaListQuery)({
        baseWhere: { bikeId, isDeleted: false },
        query: sanitizedQuery,
        defaultSort: "-changeDate",
    });
    const [result, meta] = yield Promise.all([
        prisma_1.prisma.engineOilLog.findMany({
            where,
            orderBy,
            skip,
            take,
            include: oilTypeInclude,
        }),
        prisma_1.prisma.engineOilLog.count({ where }),
    ]);
    return { result: result.map(toApiShape), meta };
});
const getEngineOilLogByIdFromDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const log = yield prisma_1.prisma.engineOilLog.findFirst({
        where: { id, bikeId, isDeleted: false },
        include: oilTypeInclude,
    });
    if (!log) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Engine oil log not found");
    }
    return toApiShape(log);
});
const updateEngineOilLogInDB = (bikeId, userId, id, payload) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const log = yield prisma_1.prisma.engineOilLog.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!log) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Engine oil log not found");
    }
    if (payload.oilType) {
        yield (0, engineOilType_utils_1.findOwnedEngineOilTypeOrThrow)(payload.oilType, userId);
    }
    if (payload.changeDate) {
        assertNotBeforePurchase(payload.changeDate, bike.purchaseDate);
    }
    // ! re-run the sequence check whenever the reading or the date moves; excludeId keeps a
    // ! log from conflicting with itself, so correcting a typo on the newest log still works
    if (payload.odometerReading !== undefined || payload.changeDate !== undefined) {
        yield (0, engineOilLog_utils_1.assertOilOdometerInSequence)(bike, {
            reading: (_a = payload.odometerReading) !== null && _a !== void 0 ? _a : log.odometerReading,
            date: (_b = payload.changeDate) !== null && _b !== void 0 ? _b : log.changeDate,
            excludeId: id,
        });
    }
    const updateData = Object.assign({}, payload);
    // ! client sends `oilType` (a plain id string); the Prisma column is `oilTypeId`
    if ("oilType" in updateData) {
        updateData.oilTypeId = updateData.oilType;
        delete updateData.oilType;
    }
    // ! D3: recompute the due point when the reading or the interval moves — and ONLY then.
    // ! Changing `oilType` alone must NOT re-seed the interval from the new catalog row: a
    // ! rider relabelling a past change would otherwise silently move its due point. The
    // ! client re-seeds its own visible field and submits the number if that is what it wants.
    const newOdometer = (_c = payload.odometerReading) !== null && _c !== void 0 ? _c : log.odometerReading;
    const newInterval = (_e = (_d = payload.intervalKmUsed) !== null && _d !== void 0 ? _d : log.intervalKmUsed) !== null && _e !== void 0 ? _e : undefined;
    if ((payload.odometerReading !== undefined ||
        payload.intervalKmUsed !== undefined) &&
        newInterval !== undefined) {
        updateData.nextDueOdometer = (0, engineOilLog_utils_1.computeNextDueOdometer)(newOdometer, newInterval);
    }
    const updated = yield prisma_1.prisma.engineOilLog.update({
        where: { id: log.id },
        data: updateData,
        include: oilTypeInclude,
    });
    // ! an edit that raises the reading must bump the bike too, or currentOdometer ends up
    // ! below the highest logged reading with no race involved (spec 49 §C)
    if (payload.odometerReading !== undefined) {
        yield (0, bike_utils_1.bumpOdometerIfHigher)(bike, updated.odometerReading);
    }
    return toApiShape(updated);
});
// ! Soft delete. There is no "locked" rule here, unlike fuel logs: nothing downstream
// ! closes a period over an oil log (that is MileageRecord's job and it is untouched by
// ! this module), so there is nothing to protect.
const deleteEngineOilLogFromDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const log = yield prisma_1.prisma.engineOilLog.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!log) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Engine oil log not found");
    }
    const updated = yield prisma_1.prisma.engineOilLog.update({
        where: { id: log.id },
        data: { isDeleted: true },
        include: oilTypeInclude,
    });
    return toApiShape(updated);
});
// §D — the forecast. Nothing is stored: every figure is derived on read from the newest
// live oil log, `bike.currentOdometer` read LIVE on this request, and the riding rate.
// ! That is exactly what satisfies the developer's "based on the updated odometer reading
// ! I should see updated data" requirement (D4/H5) — a Settings odometer update (spec 44)
// ! shows up on the very next request, with no recompute job and no cache to go stale.
const getEngineOilStatusFromDB = (bikeId, userId) => __awaiter(void 0, void 0, void 0, function* () {
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const last = yield (0, engineOilLog_utils_1.findLatestEngineOilLog)(bikeId);
    // state 1 — no oil log yet. Not an error: the client shows a "log your last oil change" CTA.
    if (!last) {
        return {
            status: "unknown",
            currentOdometer: bike.currentOdometer,
            lastChange: null,
        };
    }
    const rate = yield (0, ridingRate_1.computeKmPerDay)(bikeId);
    const due = (0, engineOilLog_utils_1.evaluateOilDue)(last, bike.currentOdometer, rate);
    const lastChange = {
        _id: last.id,
        changeDate: last.changeDate,
        odometerReading: last.odometerReading,
        oilType: last.oilType
            ? { _id: last.oilType.id, name: last.oilType.name }
            : null,
        oilFilterChanged: last.oilFilterChanged,
    };
    if (last.intervalKmUsed !== null) {
        lastChange.intervalKm = last.intervalKmUsed;
    }
    if (last.nextDueOdometer !== null) {
        lastChange.nextDueOdometer = last.nextDueOdometer;
    }
    const result = {
        status: due.status,
        currentOdometer: bike.currentOdometer,
        lastChange,
        kmSinceChange: due.kmSinceChange,
    };
    // state 2 — a log with no interval (H7's imported row): the distance is still worth
    // showing, so `kmSinceChange` stays and everything derived from an interval is omitted.
    if (due.kmRemaining !== undefined) {
        result.kmRemaining = due.kmRemaining;
        result.percentUsed = due.percentUsed;
    }
    // state 3 — no usable riding rate (new bike, <2 fuel logs in 28 days, <100 km covered):
    // the distance fields stay, the projection is omitted, and `status` already fell back to
    // the 50 km rule inside evaluateOilDue.
    if (rate) {
        // ! 1dp — a raw 42.857142857142854 in a payload is noise. Reported even when overdue:
        // ! spec 52 D6, without it a wrong date is undebuggable.
        result.kmPerDay = Math.round(rate.kmPerDay * 10) / 10;
        result.rateBasis = {
            spanDays: rate.spanDays,
            distanceKm: rate.distanceKm,
        };
    }
    if (due.projectedDays !== undefined) {
        result.projectedDaysRemaining = due.projectedDays;
        result.projectedDueDate = new Date(Date.now() + due.projectedDays * ridingRate_1.DAY_MS);
    }
    return result;
});
const uploadEngineOilLogImageIntoDB = (bikeId, userId, id, file) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    if (!file) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "Image file is required");
    }
    const log = yield prisma_1.prisma.engineOilLog.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!log) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Engine oil log not found");
    }
    const existingReceiptImage = log.receiptImage;
    if (existingReceiptImage) {
        yield (0, cloudinary_1.deleteCloudinaryImage)(existingReceiptImage.publicId);
    }
    const updated = yield prisma_1.prisma.engineOilLog.update({
        where: { id: log.id },
        data: { receiptImage: { url: file.path, publicId: file.filename } },
        include: oilTypeInclude,
    });
    return toApiShape(updated);
});
// ! H8: on an IMPORTED row the `{ url, publicId }` here was copied from the source
// ! maintenance log's `serviceImage` — the file itself was never re-uploaded, so the asset
// ! had two owners until `--finalize` soft-deleted that source log. Finalize is what leaves
// ! exactly one live owner, which is the second reason §H's two steps are both mandatory.
const deleteEngineOilLogImageFromDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const log = yield prisma_1.prisma.engineOilLog.findFirst({
        where: { id, bikeId, isDeleted: false },
    });
    if (!log) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Engine oil log not found");
    }
    const existingReceiptImage = log.receiptImage;
    if (!existingReceiptImage) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Receipt image not found");
    }
    yield (0, cloudinary_1.deleteCloudinaryImage)(existingReceiptImage.publicId);
    const updated = yield prisma_1.prisma.engineOilLog.update({
        where: { id: log.id },
        data: { receiptImage: client_1.Prisma.JsonNull },
        include: oilTypeInclude,
    });
    return toApiShape(updated);
});
exports.engineOilLogServices = {
    createEngineOilLogIntoDB,
    getEngineOilLogsFromDB,
    getEngineOilLogByIdFromDB,
    updateEngineOilLogInDB,
    deleteEngineOilLogFromDB,
    getEngineOilStatusFromDB,
    uploadEngineOilLogImageIntoDB,
    deleteEngineOilLogImageFromDB,
};
