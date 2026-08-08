import { Router } from "express";
import { notificationController } from "./notification.controller";

const router = Router();

// ! no authCheck — protected by the x-cron-secret header instead (see notification.controller.ts)
router.post("/weekly-summary", notificationController.triggerWeeklySummary);

//
export const notificationRouter = router;
