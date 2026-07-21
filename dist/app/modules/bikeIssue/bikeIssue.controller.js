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
exports.bikeIssueController = void 0;
const http_status_1 = __importDefault(require("http-status"));
const catchAsync_1 = __importDefault(require("../../util/catchAsync"));
const sendResponse_1 = __importDefault(require("../../util/sendResponse"));
const bikeIssue_service_1 = require("./bikeIssue.service");
const createBikeIssue = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield bikeIssue_service_1.bikeIssueServices.createBikeIssueIntoDB(req.params.bikeId, req.user.userId, req.body);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.CREATED,
        success: true,
        message: "Bike issue created successfully",
        data: result,
    });
}));
const getBikeIssues = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { result, meta } = yield bikeIssue_service_1.bikeIssueServices.getBikeIssuesFromDB(req.params.bikeId, req.user.userId, req.query);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Bike issues retrieved successfully",
        data: { result, meta },
    });
}));
const getBikeIssueById = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield bikeIssue_service_1.bikeIssueServices.getBikeIssueByIdFromDB(req.params.bikeId, req.user.userId, req.params.id);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Bike issue retrieved successfully",
        data: result,
    });
}));
const updateBikeIssue = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield bikeIssue_service_1.bikeIssueServices.updateBikeIssueInDB(req.params.bikeId, req.user.userId, req.params.id, req.body);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Bike issue updated successfully",
        data: result,
    });
}));
const deleteBikeIssue = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield bikeIssue_service_1.bikeIssueServices.deleteBikeIssueFromDB(req.params.bikeId, req.user.userId, req.params.id);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Bike issue deleted successfully",
        data: result,
    });
}));
const updateBikeIssueStatus = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const result = yield bikeIssue_service_1.bikeIssueServices.updateBikeIssueStatus(req.params.bikeId, req.user.userId, req.params.id, (_a = req.body) === null || _a === void 0 ? void 0 : _a.status);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Bike issue status updated successfully",
        data: result,
    });
}));
exports.bikeIssueController = {
    createBikeIssue,
    getBikeIssues,
    getBikeIssueById,
    updateBikeIssue,
    deleteBikeIssue,
    updateBikeIssueStatus,
};
