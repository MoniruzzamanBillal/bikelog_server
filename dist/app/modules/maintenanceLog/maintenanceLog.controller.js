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
exports.maintenanceLogController = void 0;
const http_status_1 = __importDefault(require("http-status"));
const AppError_1 = __importDefault(require("../../Error/AppError"));
const catchAsync_1 = __importDefault(require("../../util/catchAsync"));
// ! for creating a maintenance log
const createMaintenanceLog = (0, catchAsync_1.default)(() => __awaiter(void 0, void 0, void 0, function* () {
    throw new AppError_1.default(http_status_1.default.NOT_IMPLEMENTED, "Not implemented yet");
}));
// ! for getting all maintenance logs for a bike
const getMaintenanceLogs = (0, catchAsync_1.default)(() => __awaiter(void 0, void 0, void 0, function* () {
    throw new AppError_1.default(http_status_1.default.NOT_IMPLEMENTED, "Not implemented yet");
}));
// ! for getting a single maintenance log by id
const getMaintenanceLogById = (0, catchAsync_1.default)(() => __awaiter(void 0, void 0, void 0, function* () {
    throw new AppError_1.default(http_status_1.default.NOT_IMPLEMENTED, "Not implemented yet");
}));
// ! for updating a maintenance log
const updateMaintenanceLog = (0, catchAsync_1.default)(() => __awaiter(void 0, void 0, void 0, function* () {
    throw new AppError_1.default(http_status_1.default.NOT_IMPLEMENTED, "Not implemented yet");
}));
// ! for deleting a maintenance log
const deleteMaintenanceLog = (0, catchAsync_1.default)(() => __awaiter(void 0, void 0, void 0, function* () {
    throw new AppError_1.default(http_status_1.default.NOT_IMPLEMENTED, "Not implemented yet");
}));
// ! for getting due/overdue/upcoming maintenance reminders for a bike
const getReminders = (0, catchAsync_1.default)(() => __awaiter(void 0, void 0, void 0, function* () {
    throw new AppError_1.default(http_status_1.default.NOT_IMPLEMENTED, "Not implemented yet");
}));
//
exports.maintenanceLogController = {
    createMaintenanceLog,
    getMaintenanceLogs,
    getMaintenanceLogById,
    updateMaintenanceLog,
    deleteMaintenanceLog,
    getReminders,
};
