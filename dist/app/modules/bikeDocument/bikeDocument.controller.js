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
exports.bikeDocumentController = void 0;
const http_status_1 = __importDefault(require("http-status"));
const catchAsync_1 = __importDefault(require("../../util/catchAsync"));
const sendResponse_1 = __importDefault(require("../../util/sendResponse"));
const bikeDocument_service_1 = require("./bikeDocument.service");
const createBikeDocument = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield bikeDocument_service_1.bikeDocumentServices.createBikeDocumentIntoDB(req.params.bikeId, req.user.userId, req.body);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.CREATED,
        success: true,
        message: "Bike document created successfully",
        data: result,
    });
}));
const getBikeDocuments = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { result, meta } = yield bikeDocument_service_1.bikeDocumentServices.getBikeDocumentsFromDB(req.params.bikeId, req.user.userId, req.query);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Bike documents retrieved successfully",
        data: { result, meta },
    });
}));
const getBikeDocumentById = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield bikeDocument_service_1.bikeDocumentServices.getBikeDocumentByIdFromDB(req.params.bikeId, req.user.userId, req.params.id);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Bike document retrieved successfully",
        data: result,
    });
}));
const updateBikeDocument = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield bikeDocument_service_1.bikeDocumentServices.updateBikeDocumentIntoDB(req.params.bikeId, req.user.userId, req.params.id, req.body);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Bike document updated successfully",
        data: result,
    });
}));
const deleteBikeDocument = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield bikeDocument_service_1.bikeDocumentServices.deleteBikeDocumentFromDB(req.params.bikeId, req.user.userId, req.params.id);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Bike document deleted successfully",
        data: result,
    });
}));
const addBikeDocumentFiles = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield bikeDocument_service_1.bikeDocumentServices.addBikeDocumentFilesIntoDB(req.params.bikeId, req.user.userId, req.params.id, req.files);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Bike document files added successfully",
        data: result,
    });
}));
const deleteBikeDocumentFile = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield bikeDocument_service_1.bikeDocumentServices.deleteBikeDocumentFileFromDB(req.params.bikeId, req.user.userId, req.params.id, req.params.fileId);
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Bike document file deleted successfully",
        data: result,
    });
}));
exports.bikeDocumentController = {
    createBikeDocument,
    getBikeDocuments,
    getBikeDocumentById,
    updateBikeDocument,
    deleteBikeDocument,
    addBikeDocumentFiles,
    deleteBikeDocumentFile,
};
