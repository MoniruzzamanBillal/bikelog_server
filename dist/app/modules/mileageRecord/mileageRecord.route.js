"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mileageRecordRouter = void 0;
const express_1 = require("express");
const authCheck_1 = __importDefault(require("../../middleware/authCheck"));
const mileageRecord_controller_1 = require("./mileageRecord.controller");
const router = (0, express_1.Router)({ mergeParams: true });
// ! exact MileageRecord history + live approximate rolling-average
router.get("/", authCheck_1.default, mileageRecord_controller_1.mileageRecordController.getMileageRecords);
// ! one month's mileage totals
router.get("/monthly", authCheck_1.default, mileageRecord_controller_1.mileageRecordController.getMonthlyMileage);
// ! a year's per-month mileage totals
router.get("/yearly", authCheck_1.default, mileageRecord_controller_1.mileageRecordController.getYearlyMileage);
// ! lifetime (since-purchase) mileage totals
router.get("/lifetime", authCheck_1.default, mileageRecord_controller_1.mileageRecordController.getLifetimeMileage);
// ! rolling last-N-months mileage trend for charting
router.get("/trend", authCheck_1.default, mileageRecord_controller_1.mileageRecordController.getMileageTrend);
//
exports.mileageRecordRouter = router;
