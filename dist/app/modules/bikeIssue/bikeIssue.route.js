"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bikeIssueRouter = void 0;
const express_1 = require("express");
const authCheck_1 = __importDefault(require("../../middleware/authCheck"));
const validateRequest_1 = __importDefault(require("../../middleware/validateRequest"));
const bikeIssue_controller_1 = require("./bikeIssue.controller");
const bikeIssue_validation_1 = require("./bikeIssue.validation");
// ! mounted at /bikes/:bikeId/issues
const router = (0, express_1.Router)({ mergeParams: true });
router.post("/", authCheck_1.default, (0, validateRequest_1.default)(bikeIssue_validation_1.bikeIssueValidations.createBikeIssueSchema), bikeIssue_controller_1.bikeIssueController.createBikeIssue);
router.get("/", authCheck_1.default, bikeIssue_controller_1.bikeIssueController.getBikeIssues);
router.get("/:id", authCheck_1.default, bikeIssue_controller_1.bikeIssueController.getBikeIssueById);
router.patch("/:id", authCheck_1.default, (0, validateRequest_1.default)(bikeIssue_validation_1.bikeIssueValidations.updateBikeIssueSchema), bikeIssue_controller_1.bikeIssueController.updateBikeIssue);
router.delete("/:id", authCheck_1.default, bikeIssue_controller_1.bikeIssueController.deleteBikeIssue);
router.patch("/:id/status", authCheck_1.default, (0, validateRequest_1.default)(bikeIssue_validation_1.bikeIssueValidations.updateBikeIssueStatusSchema), bikeIssue_controller_1.bikeIssueController.updateBikeIssueStatus);
//
exports.bikeIssueRouter = router;
