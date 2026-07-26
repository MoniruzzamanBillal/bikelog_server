import { Router } from "express";
import authCheck from "../../middleware/authCheck";
import { spendingController } from "./spending.controller";

const router = Router({ mergeParams: true });

// ! for getting the spending summary (total + category breakdown) for a bike
router.get("/", authCheck, spendingController.getSpendingSummary);

// ! rolling last-N-months spending trend for charting
router.get("/trend", authCheck, spendingController.getSpendingTrend);

//
export const spendingRouter = router;
