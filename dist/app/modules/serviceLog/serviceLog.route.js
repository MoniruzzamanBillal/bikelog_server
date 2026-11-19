"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.serviceLogRouter = void 0;
const express_1 = require("express");
const authCheck_1 = __importDefault(require("../../middleware/authCheck"));
const validateRequest_1 = __importDefault(require("../../middleware/validateRequest"));
const upload_1 = require("../../middleware/upload");
const serviceLog_controller_1 = require("./serviceLog.controller");
const serviceLog_validation_1 = require("./serviceLog.validation");
const router = (0, express_1.Router)({ mergeParams: true });
// ! MUST stay above `GET /:id` — Express matches in registration order, so `/:id` would
// ! otherwise swallow the literal `status` and the service would 404 looking for a log with
// ! id "status" (same trap as the oil module's §0 H1).
router.get("/status", authCheck_1.default, serviceLog_controller_1.serviceLogController.getServiceStatus);
router.post("/", authCheck_1.default, (0, validateRequest_1.default)(serviceLog_validation_1.serviceLogValidations.createServiceLogSchema), serviceLog_controller_1.serviceLogController.createServiceLog);
router.get("/", authCheck_1.default, serviceLog_controller_1.serviceLogController.getServiceLogs);
router.get("/:id", authCheck_1.default, serviceLog_controller_1.serviceLogController.getServiceLogById);
router.patch("/:id", authCheck_1.default, (0, validateRequest_1.default)(serviceLog_validation_1.serviceLogValidations.updateServiceLogSchema), serviceLog_controller_1.serviceLogController.updateServiceLog);
router.delete("/:id", authCheck_1.default, serviceLog_controller_1.serviceLogController.deleteServiceLog);
router.put("/:id/image", authCheck_1.default, upload_1.upload.single("image"), serviceLog_controller_1.serviceLogController.uploadServiceLogImage);
router.delete("/:id/image", authCheck_1.default, serviceLog_controller_1.serviceLogController.deleteServiceLogImage);
exports.serviceLogRouter = router;
