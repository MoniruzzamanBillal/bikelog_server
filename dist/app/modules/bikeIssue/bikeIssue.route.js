"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bikeIssueRouter = void 0;
const express_1 = require("express");
const authCheck_1 = __importDefault(require("../../middleware/authCheck"));
const validateRequest_1 = __importDefault(require("../../middleware/validateRequest"));
const upload_1 = require("../../middleware/upload");
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
// ! for adding one or more evidence images (up to 5 per request)
router.post("/:id/images", authCheck_1.default, upload_1.upload.array("images", 5), bikeIssue_controller_1.bikeIssueController.addBikeIssueImages);
// ! for removing a single evidence image by its own subdocument id
router.delete("/:id/images/:imageId", authCheck_1.default, bikeIssue_controller_1.bikeIssueController.deleteBikeIssueImage);
//
exports.bikeIssueRouter = router;
