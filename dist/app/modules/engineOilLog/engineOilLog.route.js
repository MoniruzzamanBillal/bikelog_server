"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.engineOilLogRouter = void 0;
const express_1 = require("express");
const authCheck_1 = __importDefault(require("../../middleware/authCheck"));
const validateRequest_1 = __importDefault(require("../../middleware/validateRequest"));
const upload_1 = require("../../middleware/upload");
const engineOilLog_controller_1 = require("./engineOilLog.controller");
const engineOilLog_validation_1 = require("./engineOilLog.validation");
const router = (0, express_1.Router)({ mergeParams: true });
// ! §0 H1 — MUST stay above `GET /:id`. Express matches in registration order, so
// ! `router.get("/:id")` happily matches the literal path `status`: the service would look
// ! for an engine oil log with id "status", find none, and throw
// ! `404 Engine oil log not found` with no hint that routing is the problem.
// ! for the oil-change forecast — km on this oil, km remaining, projected due date
router.get("/status", authCheck_1.default, engineOilLog_controller_1.engineOilLogController.getEngineOilStatus);
// ! for creating an engine oil log
router.post("/", authCheck_1.default, (0, validateRequest_1.default)(engineOilLog_validation_1.engineOilLogValidations.createEngineOilLogSchema), engineOilLog_controller_1.engineOilLogController.createEngineOilLog);
// ! for getting all engine oil logs for a bike
router.get("/", authCheck_1.default, engineOilLog_controller_1.engineOilLogController.getEngineOilLogs);
// ! for getting a single engine oil log by id
router.get("/:id", authCheck_1.default, engineOilLog_controller_1.engineOilLogController.getEngineOilLogById);
// ! for updating an engine oil log
router.patch("/:id", authCheck_1.default, (0, validateRequest_1.default)(engineOilLog_validation_1.engineOilLogValidations.updateEngineOilLogSchema), engineOilLog_controller_1.engineOilLogController.updateEngineOilLog);
// ! for deleting an engine oil log
router.delete("/:id", authCheck_1.default, engineOilLog_controller_1.engineOilLogController.deleteEngineOilLog);
// ! for uploading/replacing the receipt image
router.put("/:id/image", authCheck_1.default, upload_1.upload.single("image"), engineOilLog_controller_1.engineOilLogController.uploadEngineOilLogImage);
// ! for removing the receipt image
router.delete("/:id/image", authCheck_1.default, engineOilLog_controller_1.engineOilLogController.deleteEngineOilLogImage);
//
exports.engineOilLogRouter = router;
