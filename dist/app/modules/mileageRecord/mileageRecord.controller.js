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
exports.mileageRecordController = void 0;
const http_status_1 = __importDefault(require("http-status"));
const AppError_1 = __importDefault(require("../../Error/AppError"));
const catchAsync_1 = __importDefault(require("../../util/catchAsync"));
const sendResponse_1 = __importDefault(require("../../util/sendResponse"));
const mileageRecord_service_1 = require("./mileageRecord.service");
const bike_utils_1 = require("../bike/bike.utils");
const getMileageRecords = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(req.params.bikeId, req.user.userId);
    const result = yield mileageRecord_service_1.mileageRecordServices.getMileageRecordsFromDB(req.params.bikeId);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Mileage records retrieved successfully",
        data: result,
    });
}));
const getMonthlyMileage = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(req.params.bikeId, req.user.userId);
    const targetMonth = req.query.targetMonth;
    if (!targetMonth) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "targetMonth query parameter is required (format: YYYY-MM)");
    }
    const result = yield mileageRecord_service_1.mileageRecordServices.getMonthlyMileageFromDB(req.params.bikeId, targetMonth);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Monthly mileage retrieved successfully",
        data: result,
    });
}));
const getYearlyMileage = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(req.params.bikeId, req.user.userId);
    const targetYear = req.query.targetYear;
    if (!targetYear) {
        throw new AppError_1.default(http_status_1.default.BAD_REQUEST, "targetYear query parameter is required (format: YYYY)");
    }
    const result = yield mileageRecord_service_1.mileageRecordServices.getYearlyMileageFromDB(req.params.bikeId, targetYear);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Yearly mileage retrieved successfully",
        data: result,
    });
}));
const getLifetimeMileage = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, bike_utils_1.findOwnedBikeOrThrow)(req.params.bikeId, req.user.userId);
    const result = yield mileageRecord_service_1.mileageRecordServices.getLifetimeMileageFromDB(req.params.bikeId);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Lifetime mileage retrieved successfully",
        data: result,
    });
}));
exports.mileageRecordController = {
    getMileageRecords,
    getMonthlyMileage,
    getYearlyMileage,
    getLifetimeMileage,
};
