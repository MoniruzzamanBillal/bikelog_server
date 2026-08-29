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
exports.errorLogServices = void 0;
const http_status_1 = __importDefault(require("http-status"));
const AppError_1 = __importDefault(require("../../Error/AppError"));
const Queryuilder_1 = __importDefault(require("../../builder/Queryuilder"));
const errorLog_model_1 = require("./errorLog.model");
const createErrorLog = (payload) => __awaiter(void 0, void 0, void 0, function* () {
    return yield errorLog_model_1.errorLogModel.create(payload);
});
const getErrorLogsFromDB = (query) => __awaiter(void 0, void 0, void 0, function* () {
    const errorLogsQuery = new Queryuilder_1.default(errorLog_model_1.errorLogModel.find(), query)
        .filter()
        .sort()
        .pagination()
        .field();
    const result = yield errorLogsQuery.queryModel;
    const meta = yield errorLogsQuery.countTotal();
    return { result, meta };
});
const getErrorLogByIdFromDB = (id) => __awaiter(void 0, void 0, void 0, function* () {
    const errorLog = yield errorLog_model_1.errorLogModel.findById(id);
    if (!errorLog) {
        throw new AppError_1.default(http_status_1.default.NOT_FOUND, "Error log not found");
    }
    return errorLog;
});
exports.errorLogServices = {
    createErrorLog,
    getErrorLogsFromDB,
    getErrorLogByIdFromDB,
};
