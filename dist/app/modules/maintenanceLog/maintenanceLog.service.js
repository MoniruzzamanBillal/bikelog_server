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
const http_status_1 = __importDefault(require("http-status"));
const AppError_1 = __importDefault(require("../../Error/AppError"));
const Queryuilder_1 = __importDefault(require("../../builder/Queryuilder"));
const bike_utils_1 = require("../bike/bike.utils");
const maintenanceType_model_1 = require("../maintenanceType/maintenanceType.model");
const engineOilType_model_1 = require("../engineOilType/engineOilType.model");
const maintenanceLog_model_1 = require("./maintenanceLog.model");
const computeNextDueOdometer = (odometerReading, intervalKmUsed) => {
    return odometerReading + intervalKmUsed;
};
const createMaintenanceLogIntoDB = (bikeId, userId, payload) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const maintenanceType = yield maintenanceType_model_1.maintenanceTypeModel.findById(payload.maintenanceType);
    if (!maintenanceType) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Maintenance type not found");
    }
    if (payload.oilType) {
        const oilType = yield engineOilType_model_1.engineOilTypeModel.findById(payload.oilType);
        if (!oilType) {
            throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Engine oil type not found");
        }
    }
    const nextDueOdometer = computeNextDueOdometer(payload.odometerReading, payload.intervalKmUsed);
    const logData = Object.assign(Object.assign({}, payload), { bike: bikeId, nextDueOdometer, serviceDate: (_a = payload.serviceDate) !== null && _a !== void 0 ? _a : new Date() });
    const log = yield maintenanceLog_model_1.maintenanceLogModel.create(logData);
    yield (0, bike_utils_1.bumpOdometerIfHigher)(bike, payload.odometerReading);
    return log;
});
const getMaintenanceLogsFromDB = (bikeId, userId, query) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    // ! strip client-controlled "bike"/"isDeleted" keys before they reach QueryBuilder.filter() —
    // ! its .find(queryObj) call merges into the query and a later key wins, so an unsanitized
    // ! `?bike=<otherBikeId>` would silently override the ownership-scoped filter below
    const sanitizedQuery = Object.assign({}, query);
    delete sanitizedQuery.bike;
    delete sanitizedQuery.isDeleted;
    const logsQuery = new Queryuilder_1.default(maintenanceLog_model_1.maintenanceLogModel.find({ bike: bikeId, isDeleted: false }), sanitizedQuery)
        .filter()
        .sort("-serviceDate")
        .pagination()
        .field();
    const result = yield logsQuery.queryModel;
    const meta = yield logsQuery.countTotal();
    return { result, meta };
});
const getMaintenanceLogByIdFromDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const log = yield maintenanceLog_model_1.maintenanceLogModel.findOne({
        _id: id,
        bike: bikeId,
        isDeleted: false,
    });
    if (!log) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Maintenance log not found");
    }
    return log;
});
const updateMaintenanceLogInDB = (bikeId, userId, id, payload) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const log = yield maintenanceLog_model_1.maintenanceLogModel.findOne({
        _id: id,
        bike: bikeId,
        isDeleted: false,
    });
    if (!log) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Maintenance log not found");
    }
    if (payload.maintenanceType) {
        const maintenanceType = yield maintenanceType_model_1.maintenanceTypeModel.findById(payload.maintenanceType);
        if (!maintenanceType) {
            throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Maintenance type not found");
        }
    }
    if (payload.oilType) {
        const oilType = yield engineOilType_model_1.engineOilTypeModel.findById(payload.oilType);
        if (!oilType) {
            throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Engine oil type not found");
        }
    }
    const updateData = Object.assign({}, payload);
    delete updateData.nextDueOdometer;
    const newOdometer = (_a = updateData.odometerReading) !== null && _a !== void 0 ? _a : log.odometerReading;
    const newInterval = (_b = updateData.intervalKmUsed) !== null && _b !== void 0 ? _b : log.intervalKmUsed;
    if (updateData.odometerReading !== undefined || updateData.intervalKmUsed !== undefined) {
        updateData.nextDueOdometer = computeNextDueOdometer(newOdometer, newInterval);
    }
    Object.assign(log, updateData);
    yield log.save();
    return log;
});
const deleteMaintenanceLogFromDB = (bikeId, userId, id) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const log = yield maintenanceLog_model_1.maintenanceLogModel.findOne({
        _id: id,
        bike: bikeId,
        isDeleted: false,
    });
    if (!log) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Maintenance log not found");
    }
    log.isDeleted = true;
    yield log.save();
    return log;
});
const getRemindersFromDB = (bikeId, userId) => __awaiter(void 0, void 0, void 0, function* () {
    const bike = yield (0, bike_utils_1.findOwnedBikeOrThrow)(bikeId, userId);
    const logs = yield maintenanceLog_model_1.maintenanceLogModel
        .find({ bike: bikeId, isDeleted: false })
        .sort({ serviceDate: -1 })
        .lean();
    const latestPerType = new Map();
    for (const log of logs) {
        const key = log.maintenanceType.toString();
        if (!latestPerType.has(key)) {
            latestPerType.set(key, log);
        }
    }
    const reminders = [];
    for (const [, log] of latestPerType) {
        const kmRemaining = log.nextDueOdometer - bike.currentOdometer;
        const kmOverdue = kmRemaining <= 0;
        const kmUpcoming = !kmOverdue && kmRemaining <= 50;
        let status = null;
        if (kmOverdue) {
            status = "overdue";
        }
        else if (kmUpcoming) {
            status = "upcoming";
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
                maintenanceType: log.maintenanceType,
                lastServiceDate: log.serviceDate,
                lastOdometerReading: log.odometerReading,
                nextDueOdometer: log.nextDueOdometer,
                status,
                kmRemaining: Math.max(0, kmRemaining),
            };
            if (log.nextDueDate) {
                reminder.nextDueDate = log.nextDueDate;
                reminder.daysRemaining = daysRemaining;
            }
            reminders.push(reminder);
        }
    }
    return { reminders };
});
exports.maintenanceLogServices = {
    createMaintenanceLogIntoDB,
    getMaintenanceLogsFromDB,
    getMaintenanceLogByIdFromDB,
    updateMaintenanceLogInDB,
    deleteMaintenanceLogFromDB,
    getRemindersFromDB,
};
