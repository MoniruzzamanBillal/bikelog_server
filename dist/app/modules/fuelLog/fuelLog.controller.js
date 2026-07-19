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
exports.fuelLogController = void 0;
const http_status_1 = __importDefault(require("http-status"));
const catchAsync_1 = __importDefault(require("../../util/catchAsync"));
const sendResponse_1 = __importDefault(require("../../util/sendResponse"));
const fuelLog_service_1 = require("./fuelLog.service");
const createFuelLog = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { fuelLog, mileageRecordClosed } = yield fuelLog_service_1.fuelLogServices.createFuelLogIntoDB(req.params.bikeId, req.user.userId, req.body);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.CREATED,
        success: true,
        message: "Fuel log created successfully",
        data: { fuelLog, mileageRecordClosed },
    });
}));
const getFuelLogs = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { result, meta } = yield fuelLog_service_1.fuelLogServices.getFuelLogsFromDB(req.params.bikeId, req.user.userId, req.query);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Fuel logs retrieved successfully",
        data: { result, meta },
    });
}));
const getFuelLogById = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield fuelLog_service_1.fuelLogServices.getFuelLogByIdFromDB(req.params.bikeId, req.user.userId, req.params.id);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Fuel log retrieved successfully",
        data: result,
    });
}));
const updateFuelLog = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield fuelLog_service_1.fuelLogServices.updateFuelLogInDB(req.params.bikeId, req.user.userId, req.params.id, req.body);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Fuel log updated successfully",
        data: result,
    });
}));
const deleteFuelLog = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield fuelLog_service_1.fuelLogServices.deleteFuelLogFromDB(req.params.bikeId, req.user.userId, req.params.id);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Fuel log deleted successfully",
        data: result,
    });
}));
exports.fuelLogController = {
    createFuelLog,
    getFuelLogs,
    getFuelLogById,
    updateFuelLog,
    deleteFuelLog,
};
