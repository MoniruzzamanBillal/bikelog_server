"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bikeStatsRouter = void 0;
const express_1 = require("express");
const authCheck_1 = __importDefault(require("../../middleware/authCheck"));
const bikeStats_controller_1 = require("./bikeStats.controller");
const router = (0, express_1.Router)({ mergeParams: true });
// ! Spec 68: one call for the bike stat strip — avg mileage, month/lifetime spend,
// ! cost/km and oil scalars, composed server-side from the four existing endpoints.
router.get("/", authCheck_1.default, bikeStats_controller_1.bikeStatsController.getBikeStatStrip);
exports.bikeStatsRouter = router;
