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
exports.notifyExpenseTracker = void 0;
const axios_1 = __importDefault(require("axios"));
const config_1 = __importDefault(require("../config"));
const errorLog_service_1 = require("../modules/errorLog/errorLog.service");
// ! fire-and-forget — never awaited by callers, never throws, never blocks/fails
// ! bikelog's own API response. On failure, best-effort logged via errorLog for visibility.
const notifyExpenseTracker = (payload) => {
    const endpoint = `${config_1.default.expenseTrackerBaseUrl}/api/transaction-requests/ingest`;
    axios_1.default
        .post(endpoint, {
        sourceApp: "bikelog",
        sourceType: payload.sourceType,
        sourceRecordId: payload.sourceRecordId,
        userEmail: payload.userEmail,
        type: "expense",
        title: payload.title,
        description: payload.description,
        amount: payload.amount,
        occurredAt: payload.occurredAt.toISOString(),
    }, {
        headers: {
            "Content-Type": "application/json",
            "x-integration-key": config_1.default.expenseTrackerIntegrationKey,
        },
    })
        .catch((error) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        console.error("notifyExpenseTracker failed:", error);
        try {
            yield errorLog_service_1.errorLogServices.createErrorLog({
                status: 502,
                message: `Failed to sync ${payload.sourceType} spend to expenseTracker2: ${(_a = error === null || error === void 0 ? void 0 : error.message) !== null && _a !== void 0 ? _a : error}`,
                errorName: "ExpenseTrackerSyncError",
                stack: error === null || error === void 0 ? void 0 : error.stack,
                method: "POST",
                path: "/api/transaction-requests/ingest",
                userId: payload.userId,
                userEmail: payload.userEmail,
            });
        }
        catch (logError) {
            // ! last resort: even error-logging must not throw out of a fire-and-forget call
            console.error("Failed to write errorLog for expenseTracker2 sync failure:", logError);
        }
    }));
};
exports.notifyExpenseTracker = notifyExpenseTracker;
