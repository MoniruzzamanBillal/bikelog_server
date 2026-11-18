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
exports.serviceLogController = void 0;
const http_status_1 = __importDefault(require("http-status"));
const catchAsync_1 = __importDefault(require("../../util/catchAsync"));
const sendResponse_1 = __importDefault(require("../../util/sendResponse"));
const expenseTrackerClient_1 = require("../../util/expenseTrackerClient");
const transactionRequestSummary_1 = require("../../util/transactionRequestSummary");
const serviceLog_service_1 = require("./serviceLog.service");
// ! One place for the expense push, used by both create and update. Fires only when a
// ! service first becomes completed AND carries a cost — a free or still-scheduled service
// ! pushes nothing. `sourceType: "maintenance"` is reused on purpose (that union is validated
// ! on expenseTracker2's side, which is out of this cascade); dedupe there keys on
// ! sourceRecordId (the service id), so an edit never doubles the pending item.
const maybeNotifyExpenseTracker = (result, userEmail, userId) => {
    var _a;
    if (!result.justCompleted || result.itemTotal <= 0)
        return;
    const { title, description } = (0, transactionRequestSummary_1.buildServiceLogSummary)(result.log, result.bikeNickname);
    (0, expenseTrackerClient_1.notifyExpenseTracker)({
        sourceType: "maintenance",
        sourceRecordId: String(result.log._id),
        userEmail,
        userId,
        title,
        description,
        amount: result.itemTotal,
        occurredAt: (_a = result.log.serviceDate) !== null && _a !== void 0 ? _a : new Date(),
    });
};
const createServiceLog = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield serviceLog_service_1.serviceLogServices.createServiceLogIntoDB(req.params.bikeId, req.user.userId, req.body);
    maybeNotifyExpenseTracker(result, req.user.userEmail, req.user.userId);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.CREATED,
        success: true,
        message: "Service log created successfully",
        data: result.log,
    });
}));
const getServiceLogs = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { result, meta } = yield serviceLog_service_1.serviceLogServices.getServiceLogsFromDB(req.params.bikeId, req.user.userId, req.query);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Service logs retrieved successfully",
        data: { result, meta },
    });
}));
const getServiceStatus = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield serviceLog_service_1.serviceLogServices.getServiceStatusFromDB(req.params.bikeId, req.user.userId);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Service status retrieved successfully",
        data: result,
    });
}));
const getServiceLogById = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield serviceLog_service_1.serviceLogServices.getServiceLogByIdFromDB(req.params.bikeId, req.user.userId, req.params.id);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Service log retrieved successfully",
        data: result,
    });
}));
const updateServiceLog = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield serviceLog_service_1.serviceLogServices.updateServiceLogInDB(req.params.bikeId, req.user.userId, req.params.id, req.body);
    maybeNotifyExpenseTracker(result, req.user.userEmail, req.user.userId);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Service log updated successfully",
        data: result.log,
    });
}));
const deleteServiceLog = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield serviceLog_service_1.serviceLogServices.deleteServiceLogFromDB(req.params.bikeId, req.user.userId, req.params.id);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Service log deleted successfully",
        data: result,
    });
}));
const uploadServiceLogImage = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield serviceLog_service_1.serviceLogServices.uploadServiceLogImageIntoDB(req.params.bikeId, req.user.userId, req.params.id, req.file);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Receipt image uploaded successfully",
        data: result,
    });
}));
const deleteServiceLogImage = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield serviceLog_service_1.serviceLogServices.deleteServiceLogImageFromDB(req.params.bikeId, req.user.userId, req.params.id);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Receipt image deleted successfully",
        data: result,
    });
}));
exports.serviceLogController = {
    createServiceLog,
    getServiceLogs,
    getServiceStatus,
    getServiceLogById,
    updateServiceLog,
    deleteServiceLog,
    uploadServiceLogImage,
    deleteServiceLogImage,
};
