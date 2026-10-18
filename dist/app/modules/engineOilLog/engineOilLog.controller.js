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
exports.engineOilLogController = void 0;
const http_status_1 = __importDefault(require("http-status"));
const catchAsync_1 = __importDefault(require("../../util/catchAsync"));
const sendResponse_1 = __importDefault(require("../../util/sendResponse"));
const expenseTrackerClient_1 = require("../../util/expenseTrackerClient");
const transactionRequestSummary_1 = require("../../util/transactionRequestSummary");
const engineOilLog_service_1 = require("./engineOilLog.service");
const createEngineOilLog = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { log, oilTypeName, bikeNickname } = yield engineOilLog_service_1.engineOilLogServices.createEngineOilLogIntoDB(req.params.bikeId, req.user.userId, req.body);
    const { title, description } = (0, transactionRequestSummary_1.buildEngineOilLogSummary)(log, oilTypeName, bikeNickname);
    // ! D8: reuses `sourceType: "maintenance"` on purpose — that union is validated on
    // ! expenseTracker2's side and that project is explicitly out of this cascade. Ids never
    // ! collide, so dedupe over there is unaffected. A real "oil" source there is a later note.
    (0, expenseTrackerClient_1.notifyExpenseTracker)({
        sourceType: "maintenance",
        sourceRecordId: String(log._id),
        userEmail: req.user.userEmail,
        userId: req.user.userId,
        title,
        description,
        amount: log.cost,
        occurredAt: log.changeDate,
    });
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.CREATED,
        success: true,
        message: "Engine oil log created successfully",
        data: log,
    });
}));
const getEngineOilLogs = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { result, meta } = yield engineOilLog_service_1.engineOilLogServices.getEngineOilLogsFromDB(req.params.bikeId, req.user.userId, req.query);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Engine oil logs retrieved successfully",
        data: { result, meta },
    });
}));
const getEngineOilLogById = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield engineOilLog_service_1.engineOilLogServices.getEngineOilLogByIdFromDB(req.params.bikeId, req.user.userId, req.params.id);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Engine oil log retrieved successfully",
        data: result,
    });
}));
const updateEngineOilLog = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield engineOilLog_service_1.engineOilLogServices.updateEngineOilLogInDB(req.params.bikeId, req.user.userId, req.params.id, req.body);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Engine oil log updated successfully",
        data: result,
    });
}));
const deleteEngineOilLog = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield engineOilLog_service_1.engineOilLogServices.deleteEngineOilLogFromDB(req.params.bikeId, req.user.userId, req.params.id);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Engine oil log deleted successfully",
        data: result,
    });
}));
const getEngineOilStatus = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield engineOilLog_service_1.engineOilLogServices.getEngineOilStatusFromDB(req.params.bikeId, req.user.userId);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Engine oil status retrieved successfully",
        data: result,
    });
}));
const uploadEngineOilLogImage = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield engineOilLog_service_1.engineOilLogServices.uploadEngineOilLogImageIntoDB(req.params.bikeId, req.user.userId, req.params.id, req.file);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Receipt image uploaded successfully",
        data: result,
    });
}));
const deleteEngineOilLogImage = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield engineOilLog_service_1.engineOilLogServices.deleteEngineOilLogImageFromDB(req.params.bikeId, req.user.userId, req.params.id);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Receipt image deleted successfully",
        data: result,
    });
}));
exports.engineOilLogController = {
    createEngineOilLog,
    getEngineOilLogs,
    getEngineOilLogById,
    updateEngineOilLog,
    deleteEngineOilLog,
    getEngineOilStatus,
    uploadEngineOilLogImage,
    deleteEngineOilLogImage,
};
