"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.engineOilTypeRouter = void 0;
const express_1 = require("express");
const authCheck_1 = __importDefault(require("../../middleware/authCheck"));
const validateRequest_1 = __importDefault(require("../../middleware/validateRequest"));
const engineOilType_controller_1 = require("./engineOilType.controller");
const engineOilType_validation_1 = require("./engineOilType.validation");
const router = (0, express_1.Router)();
// ! for creating a custom engine oil type
router.post("/", authCheck_1.default, (0, validateRequest_1.default)(engineOilType_validation_1.engineOilTypeValidations.createEngineOilTypeSchema), engineOilType_controller_1.engineOilTypeController.createEngineOilType);
// ! for getting all engine oil types
router.get("/", authCheck_1.default, engineOilType_controller_1.engineOilTypeController.getEngineOilTypes);
//
exports.engineOilTypeRouter = router;
