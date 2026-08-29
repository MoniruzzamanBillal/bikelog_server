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
const fuelLog_model_1 = require("./fuelLog.model");
const mileageRecord_model_1 = require("../mileageRecord/mileageRecord.model");
const http_status_1 = __importDefault(require("http-status"));
const AppError_1 = __importDefault(require("../../Error/AppError"));
const Queryuilder_1 = __importDefault(require("../../builder/Queryuilder"));
const bike_utils_1 = require("../bike/bike.utils");
const cloudinary_1 = require("../../util/cloudinary");
const createFuelLogIntoDB = (bikeId, userId, payload) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const date = (_a = payload.date) !== null && _a !== void 0 ? _a : new Date();
    if (date < bike.purchaseDate) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, `Fuel log date cannot be before the bike's purchase date (${bike.purchaseDate.toISOString().split("T")[0]})`);
    }
    const totalCost = ((_b = payload.litersAdded) !== null && _b !== void 0 ? _b : 0) * ((_c = payload.pricePerLiter) !== null && _c !== void 0 ? _c : 0);
    const fuelLogData = Object.assign(Object.assign({}, payload), { bike: bikeId, totalCost,
        date });
    const fuelLog = yield fuelLog_model_1.fuelLogModel.create(fuelLogData);
    yield (0, bike_utils_1.bumpOdometerIfHigher)(bike, fuelLog.odometerReading);
    let mileageRecordClosed = null;
    if (fuelLog.isFullTank) {
        const previousFullTank = yield fuelLog_model_1.fuelLogModel
            .findOne({
            bike: bikeId,
            isFullTank: true,
            date: { $lt: fuelLog.date },
            isDeleted: false,
        })
            .sort({ date: -1 })
            .lean();
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
        const periodFuelLogs = yield fuelLog_model_1.fuelLogModel
            .find({
            bike: bikeId,
            // ! $gt, not $gte — periodStartDate is the PREVIOUS closing full-tank fill's date;
            // ! its liters already belong to the prior period and must not be double-counted here
            date: periodStartDate
                ? { $gt: periodStartDate, $lte: fuelLog.date }
                : { $lte: fuelLog.date },
            isDeleted: false,
        })
            .sort({ date: 1 })
            .lean();
        const litersConsumed = periodFuelLogs.reduce((sum, log) => sum + log.litersAdded, 0);
        const distanceKm = fuelLog.odometerReading - periodStartOdometer;
        const mileageKmPerLiter = litersConsumed > 0 ? distanceKm / litersConsumed : 0;
        const fuelLogIds = periodFuelLogs.map((log) => log._id);
        // ! for the first-ever period, derive the displayed start from the earliest fuel log
        // ! actually in it — reflects real fuel-log history instead of the bike's own creation
        // ! moment. periodFuelLogs[0] can't actually be undefined here (the just-created
        // ! fuelLog always satisfies its own $lte bound), the createdAt fallback is defensive only.
        const resolvedPeriodStartDate = (_e = periodStartDate !== null && periodStartDate !== void 0 ? periodStartDate : (_d = periodFuelLogs[0]) === null || _d === void 0 ? void 0 : _d.date) !== null && _e !== void 0 ? _e : bike.createdAt;
        mileageRecordClosed = yield mileageRecord_model_1.mileageRecordModel.create({
            bike: bikeId,
            startOdometer: periodStartOdometer,
            endOdometer: fuelLog.odometerReading,
            distanceKm,
            litersConsumed,
            mileageKmPerLiter,
            periodStartDate: resolvedPeriodStartDate,
            periodEndDate: fuelLog.date,
            fuelLogIds,
        });
    }
    return { fuelLog, mileageRecordClosed };
});
const getFuelLogsFromDB = (bikeId, userId, query) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    // ! strip client-controlled "bike"/"isDeleted" keys before they reach QueryBuilder.filter() —
    // ! its .find(queryObj) call merges into the query and a later key wins, so an unsanitized
    // ! `?bike=<otherBikeId>` would silently override the ownership-scoped filter below
    const sanitizedQuery = Object.assign({}, query);
    delete sanitizedQuery.bike;
    delete sanitizedQuery.isDeleted;
    const fuelLogsQuery = new Queryuilder_1.default(fuelLog_model_1.fuelLogModel.find({ bike: bikeId, isDeleted: false }), sanitizedQuery)
        .filter()
        .sort("-date")
        .pagination()
        .field();
    const result = yield fuelLogsQuery.queryModel;
    const meta = yield fuelLogsQuery.countTotal();
    return { result, meta };
});
const getFuelLogByIdFromDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const fuelLog = yield fuelLog_model_1.fuelLogModel.findOne({
        _id: id,
        bike: bikeId,
        isDeleted: false,
    });
    if (!fuelLog) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Fuel log not found");
    }
    return fuelLog;
});
const updateFuelLogInDB = (bikeId, userId, id, payload) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    if (payload.date && payload.date < bike.purchaseDate) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, `Fuel log date cannot be before the bike's purchase date (${bike.purchaseDate.toISOString().split("T")[0]})`);
    }
    const existsInMileageRecord = yield mileageRecord_model_1.mileageRecordModel.exists({
        fuelLogIds: id,
    });
    if (existsInMileageRecord) {
        throw new AppError_1.default(http_status_1.default.CONFLICT, "This fuel log is part of a closed mileage record and can't be edited");
    }
    // ! totalCost is always server-derived — never trust a client-submitted value directly
    delete payload.totalCost;
    if (payload.litersAdded !== undefined || payload.pricePerLiter !== undefined) {
        const fuelLog = yield fuelLog_model_1.fuelLogModel.findOne({ _id: id, bike: bikeId });
        if (fuelLog) {
            const newLiters = (_a = payload.litersAdded) !== null && _a !== void 0 ? _a : fuelLog.litersAdded;
            const newPrice = (_b = payload.pricePerLiter) !== null && _b !== void 0 ? _b : fuelLog.pricePerLiter;
            payload.totalCost = newLiters * newPrice;
        }
    }
    const fuelLog = yield fuelLog_model_1.fuelLogModel.findOneAndUpdate({ _id: id, bike: bikeId, isDeleted: false }, payload, { new: true, runValidators: true });
    if (!fuelLog) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Fuel log not found");
    }
    return fuelLog;
});
const deleteFuelLogFromDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const existsInMileageRecord = yield mileageRecord_model_1.mileageRecordModel.exists({
        fuelLogIds: id,
    });
    if (existsInMileageRecord) {
        throw new AppError_1.default(http_status_1.default.CONFLICT, "This fuel log is part of a closed mileage record and can't be deleted");
    }
    const fuelLog = yield fuelLog_model_1.fuelLogModel.findOneAndUpdate({ _id: id, bike: bikeId, isDeleted: false }, { isDeleted: true }, { new: true });
    if (!fuelLog) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Fuel log not found");
    }
    return fuelLog;
});
const uploadFuelLogImageIntoDB = (bikeId, userId, id, file) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    if (!file) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "Image file is required");
    }
    const fuelLog = yield fuelLog_model_1.fuelLogModel.findOne({
        _id: id,
        bike: bikeId,
        isDeleted: false,
    });
    if (!fuelLog) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Fuel log not found");
    }
    if (fuelLog.receiptImage) {
        yield (0, cloudinary_1.deleteCloudinaryImage)(fuelLog.receiptImage.publicId);
    }
    fuelLog.receiptImage = { url: file.path, publicId: file.filename };
    yield fuelLog.save();
    return fuelLog;
});
const deleteFuelLogImageFromDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const fuelLog = yield fuelLog_model_1.fuelLogModel.findOne({
        _id: id,
        bike: bikeId,
        isDeleted: false,
    });
    if (!fuelLog) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Fuel log not found");
    }
    if (!fuelLog.receiptImage) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Receipt image not found");
    }
    yield (0, cloudinary_1.deleteCloudinaryImage)(fuelLog.receiptImage.publicId);
    fuelLog.receiptImage = undefined;
    yield fuelLog.save();
    return fuelLog;
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
