"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.spendingRouter = void 0;
const express_1 = require("express");
const authCheck_1 = __importDefault(require("../../middleware/authCheck"));
const spending_controller_1 = require("./spending.controller");
const router = (0, express_1.Router)({ mergeParams: true });
// ! for getting the spending summary (total + category breakdown) for a bike
router.get("/", authCheck_1.default, spending_controller_1.spendingController.getSpendingSummary);
// ! rolling last-N-months spending trend for charting
router.get("/trend", authCheck_1.default, spending_controller_1.spendingController.getSpendingTrend);
// ! per-record spending detail (fuel + maintenance line items) for a given period, feeds PDF export
router.get("/details", authCheck_1.default, spending_controller_1.spendingController.getSpendingDetails);
//
exports.spendingRouter = router;
