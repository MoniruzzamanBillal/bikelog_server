import { Router } from "express";
import authCheck from "../../middleware/authCheck";
import { mileageRecordController } from "./mileageRecord.controller";

const router = Router({ mergeParams: true });

// ! exact MileageRecord history + live approximate rolling-average
router.get("/", authCheck, mileageRecordController.getMileageRecords);

// ! one month's mileage totals
router.get("/monthly", authCheck, mileageRecordController.getMonthlyMileage);

// ! a year's per-month mileage totals
router.get("/yearly", authCheck, mileageRecordController.getYearlyMileage);

// ! lifetime (since-purchase) mileage totals
router.get(
  "/lifetime",
  authCheck,
  mileageRecordController.getLifetimeMileage,
);

// ! rolling last-N-months mileage trend for charting
router.get("/trend", authCheck, mileageRecordController.getMileageTrend);

//
export const mileageRecordRouter = router;
