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
const createFuelLogIntoDB = (bikeId, userId, payload) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const totalCost = ((_a = payload.litersAdded) !== null && _a !== void 0 ? _a : 0) * ((_b = payload.pricePerLiter) !== null && _b !== void 0 ? _b : 0);
    const fuelLogData = Object.assign(Object.assign({}, payload), { bike: bikeId, totalCost, date: (_c = payload.date) !== null && _c !== void 0 ? _c : new Date() });
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
            periodStartDate = bike.createdAt;
        }
        const periodFuelLogs = yield fuelLog_model_1.fuelLogModel
            .find({
            bike: bikeId,
            // ! $gt, not $gte — periodStartDate is the PREVIOUS closing full-tank fill's date;
            // ! its liters already belong to the prior period and must not be double-counted here
            date: { $gt: periodStartDate, $lte: fuelLog.date },
            isDeleted: false,
        })
            .sort({ date: 1 })
            .lean();
        const litersConsumed = periodFuelLogs.reduce((sum, log) => sum + log.litersAdded, 0);
        const distanceKm = fuelLog.odometerReading - periodStartOdometer;
        const mileageKmPerLiter = litersConsumed > 0 ? distanceKm / litersConsumed : 0;
        const fuelLogIds = periodFuelLogs.map((log) => log._id);
        mileageRecordClosed = yield mileageRecord_model_1.mileageRecordModel.create({
            bike: bikeId,
            startOdometer: periodStartOdometer,
            endOdometer: fuelLog.odometerReading,
            distanceKm,
            litersConsumed,
            mileageKmPerLiter,
            periodStartDate,
            periodEndDate: fuelLog.date,
            fuelLogIds,
        });
    }
    return { fuelLog, mileageRecordClosed };
});
const getFuelLogsFromDB = (bikeId, userId, query) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const fuelLogsQuery = new Queryuilder_1.default(fuelLog_model_1.fuelLogModel.find({ bike: bikeId, isDeleted: false }), query)
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
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const existsInMileageRecord = yield mileageRecord_model_1.mileageRecordModel.exists({
        fuelLogIds: id,
    });
    if (existsInMileageRecord) {
        throw new AppError_1.default(http_status_1.default.CONFLICT, "This fuel log is part of a closed mileage record and can't be edited");
    }
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
exports.fuelLogServices = {
    createFuelLogIntoDB,
    getFuelLogsFromDB,
    getFuelLogByIdFromDB,
    updateFuelLogInDB,
    deleteFuelLogFromDB,
};
