"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiRouter = void 0;
const express_1 = require("express");
const authCheck_1 = __importDefault(require("../../middleware/authCheck"));
const validateRequest_1 = __importDefault(require("../../middleware/validateRequest"));
const ai_controller_1 = require("./ai.controller");
const ai_validation_1 = require("./ai.validation");
// ! mounted at /bikes/:bikeId/ai
const router = (0, express_1.Router)({ mergeParams: true });
router.get("/spending-insight", authCheck_1.default, ai_controller_1.aiController.getSpendingInsight);
router.get("/mileage-insight", authCheck_1.default, ai_controller_1.aiController.getMileageInsight);
router.post("/chat", authCheck_1.default, (0, validateRequest_1.default)(ai_validation_1.aiValidations.bikeChatSchema), ai_controller_1.aiController.bikeChat);
//
exports.aiRouter = router;
