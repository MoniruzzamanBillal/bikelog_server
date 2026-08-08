"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationRouter = void 0;
const express_1 = require("express");
const notification_controller_1 = require("./notification.controller");
const router = (0, express_1.Router)();
// ! no authCheck — protected by the x-cron-secret header instead (see notification.controller.ts)
router.post("/weekly-summary", notification_controller_1.notificationController.triggerWeeklySummary);
//
exports.notificationRouter = router;
