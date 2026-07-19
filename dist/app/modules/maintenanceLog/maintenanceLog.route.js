"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.reminderRouter = exports.maintenanceLogRouter = void 0;
const express_1 = require("express");
const authCheck_1 = __importDefault(require("../../middleware/authCheck"));
const validateRequest_1 = __importDefault(require("../../middleware/validateRequest"));
const maintenanceLog_controller_1 = require("./maintenanceLog.controller");
const maintenanceLog_validation_1 = require("./maintenanceLog.validation");
// ! CRUD router — mounted at /bikes/:bikeId/maintenance-logs
const crudRouter = (0, express_1.Router)({ mergeParams: true });
crudRouter.post("/", authCheck_1.default, (0, validateRequest_1.default)(maintenanceLog_validation_1.maintenanceLogValidations.createMaintenanceLogSchema), maintenanceLog_controller_1.maintenanceLogController.createMaintenanceLog);
crudRouter.get("/", authCheck_1.default, maintenanceLog_controller_1.maintenanceLogController.getMaintenanceLogs);
crudRouter.get("/:id", authCheck_1.default, maintenanceLog_controller_1.maintenanceLogController.getMaintenanceLogById);
crudRouter.patch("/:id", authCheck_1.default, (0, validateRequest_1.default)(maintenanceLog_validation_1.maintenanceLogValidations.updateMaintenanceLogSchema), maintenanceLog_controller_1.maintenanceLogController.updateMaintenanceLog);
crudRouter.delete("/:id", authCheck_1.default, maintenanceLog_controller_1.maintenanceLogController.deleteMaintenanceLog);
// ! reminders router — mounted separately at /bikes/:bikeId/reminders
const remindersRouter = (0, express_1.Router)({ mergeParams: true });
remindersRouter.get("/", authCheck_1.default, maintenanceLog_controller_1.maintenanceLogController.getReminders);
//
exports.maintenanceLogRouter = crudRouter;
exports.reminderRouter = remindersRouter;
