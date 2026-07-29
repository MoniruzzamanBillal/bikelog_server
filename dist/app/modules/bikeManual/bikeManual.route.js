"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bikeManualRouter = void 0;
const express_1 = require("express");
const authCheck_1 = __importDefault(require("../../middleware/authCheck"));
const uploadManual_1 = require("../../middleware/uploadManual");
const bikeManual_controller_1 = require("./bikeManual.controller");
// ! mounted at /bikes/:bikeId/manual
const router = (0, express_1.Router)({ mergeParams: true });
// ! upload-or-replace, upsert semantics — no separate PUT
router.post("/", authCheck_1.default, uploadManual_1.uploadManual.single("manual"), bikeManual_controller_1.bikeManualController.uploadBikeManual);
router.get("/", authCheck_1.default, bikeManual_controller_1.bikeManualController.getBikeManual);
router.delete("/", authCheck_1.default, bikeManual_controller_1.bikeManualController.deleteBikeManual);
//
exports.bikeManualRouter = router;
