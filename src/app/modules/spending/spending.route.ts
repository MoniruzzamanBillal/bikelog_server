import { Router } from "express";
import authCheck from "../../middleware/authCheck";
import { spendingController } from "./spending.controller";

const router = Router({ mergeParams: true });

// ! for getting the spending summary (total + category breakdown) for a bike
router.get("/", authCheck, spendingController.getSpendingSummary);

// ! rolling last-N-months spending trend for charting
router.get("/trend", authCheck, spendingController.getSpendingTrend);

// ! per-record spending detail (fuel + maintenance line items) for a given period, feeds PDF export
router.get("/details", authCheck, spendingController.getSpendingDetails);

// ! spec 60: month-only category drill-down (each category + its nested line-item records)
// ! for the app Month tab's accordions. Month-by-definition — takes only targetMonth.
router.get("/monthly-breakdown", authCheck, spendingController.getMonthlyBreakdown);

// ! spec 61: year/lifetime category drill-down (each category + its time buckets — per-month
// ! for a year, per-year for lifetime) for the app Year/Lifetime tabs' accordions.
router.get("/period-breakdown", authCheck, spendingController.getPeriodBreakdown);

//
export const spendingRouter = router;
