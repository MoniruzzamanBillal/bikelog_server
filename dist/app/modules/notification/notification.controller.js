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
exports.notificationController = void 0;
const http_status_1 = __importDefault(require("http-status"));
const config_1 = __importDefault(require("../../config"));
const AppError_1 = __importDefault(require("../../Error/AppError"));
const catchAsync_1 = __importDefault(require("../../util/catchAsync"));
const sendResponse_1 = __importDefault(require("../../util/sendResponse"));
const notification_service_1 = require("./notification.service");
// ! machine-to-machine endpoint hit by a scheduled job, not a logged-in user — protected by
// ! a shared secret header instead of authCheck/JWT (see .github/workflows/weekly-summary-cron.yml)
const triggerWeeklySummary = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const secret = req.headers["x-cron-secret"];
    if (typeof secret !== "string" || secret !== config_1.default.cronSecret) {
        throw new AppError_1.default(http_status_1.default.UNAUTHORIZED, "Invalid or missing cron secret");
    }
    const result = yield notification_service_1.notificationServices.sendWeeklySummaries();
    (0, sendResponse_1.default)(res, {
        status: http_status_1.default.OK,
        success: true,
        message: "Weekly summary notifications processed",
        data: result,
    });
}));
//
exports.notificationController = {
    triggerWeeklySummary,
};
