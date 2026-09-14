"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorLogCronRouter = exports.errorLogRouter = void 0;
const express_1 = require("express");
const adminCheck_1 = __importDefault(require("../../middleware/adminCheck"));
const authCheck_1 = __importDefault(require("../../middleware/authCheck"));
const errorLog_controller_1 = require("./errorLog.controller");
const router = (0, express_1.Router)();
router.get("/", authCheck_1.default, adminCheck_1.default, errorLog_controller_1.errorLogController.getErrorLogs);
router.get("/:id", authCheck_1.default, adminCheck_1.default, errorLog_controller_1.errorLogController.getErrorLogById);
exports.errorLogRouter = router;
// ! separate router, mounted under /cron alongside notification's weekly-summary trigger —
// ! no authCheck/adminCheck, protected by the x-cron-secret header instead (see errorLog.controller.ts)
const cronRouter = (0, express_1.Router)();
cronRouter.post("/cleanup-error-logs", errorLog_controller_1.errorLogController.cleanupExpiredErrorLogs);
exports.errorLogCronRouter = cronRouter;
