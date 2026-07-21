"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bikeAccessoryRouter = void 0;
const express_1 = require("express");
const authCheck_1 = __importDefault(require("../../middleware/authCheck"));
const validateRequest_1 = __importDefault(require("../../middleware/validateRequest"));
const bikeAccessory_controller_1 = require("./bikeAccessory.controller");
const bikeAccessory_validation_1 = require("./bikeAccessory.validation");
// ! mounted at /bikes/:bikeId/accessories
const router = (0, express_1.Router)({ mergeParams: true });
router.post("/", authCheck_1.default, (0, validateRequest_1.default)(bikeAccessory_validation_1.bikeAccessoryValidations.createBikeAccessorySchema), bikeAccessory_controller_1.bikeAccessoryController.createBikeAccessory);
router.get("/", authCheck_1.default, bikeAccessory_controller_1.bikeAccessoryController.getBikeAccessories);
router.get("/:id", authCheck_1.default, bikeAccessory_controller_1.bikeAccessoryController.getBikeAccessoryById);
router.patch("/:id", authCheck_1.default, (0, validateRequest_1.default)(bikeAccessory_validation_1.bikeAccessoryValidations.updateBikeAccessorySchema), bikeAccessory_controller_1.bikeAccessoryController.updateBikeAccessory);
router.delete("/:id", authCheck_1.default, bikeAccessory_controller_1.bikeAccessoryController.deleteBikeAccessory);
//
exports.bikeAccessoryRouter = router;
