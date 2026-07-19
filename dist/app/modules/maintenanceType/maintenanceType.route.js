"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.maintenanceTypeRouter = void 0;
const express_1 = require("express");
const authCheck_1 = __importDefault(require("../../middleware/authCheck"));
const validateRequest_1 = __importDefault(require("../../middleware/validateRequest"));
const maintenanceType_controller_1 = require("./maintenanceType.controller");
const maintenanceType_validation_1 = require("./maintenanceType.validation");
const router = (0, express_1.Router)();
// ! for creating a custom maintenance type
router.post("/", authCheck_1.default, (0, validateRequest_1.default)(maintenanceType_validation_1.maintenanceTypeValidations.createMaintenanceTypeSchema), maintenanceType_controller_1.maintenanceTypeController.createMaintenanceType);
// ! for getting all maintenance types
router.get("/", authCheck_1.default, maintenanceType_controller_1.maintenanceTypeController.getMaintenanceTypes);
//
exports.maintenanceTypeRouter = router;
