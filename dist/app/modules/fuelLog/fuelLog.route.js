"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fuelLogRouter = void 0;
const express_1 = require("express");
const authCheck_1 = __importDefault(require("../../middleware/authCheck"));
const validateRequest_1 = __importDefault(require("../../middleware/validateRequest"));
const fuelLog_controller_1 = require("./fuelLog.controller");
const fuelLog_validation_1 = require("./fuelLog.validation");
const router = (0, express_1.Router)({ mergeParams: true });
// ! for creating a fuel log
router.post("/", authCheck_1.default, (0, validateRequest_1.default)(fuelLog_validation_1.fuelLogValidations.createFuelLogSchema), fuelLog_controller_1.fuelLogController.createFuelLog);
// ! for getting all fuel logs for a bike
router.get("/", authCheck_1.default, fuelLog_controller_1.fuelLogController.getFuelLogs);
// ! for getting a single fuel log by id
router.get("/:id", authCheck_1.default, fuelLog_controller_1.fuelLogController.getFuelLogById);
// ! for updating a fuel log
router.patch("/:id", authCheck_1.default, (0, validateRequest_1.default)(fuelLog_validation_1.fuelLogValidations.updateFuelLogSchema), fuelLog_controller_1.fuelLogController.updateFuelLog);
// ! for deleting a fuel log
router.delete("/:id", authCheck_1.default, fuelLog_controller_1.fuelLogController.deleteFuelLog);
//
exports.fuelLogRouter = router;
