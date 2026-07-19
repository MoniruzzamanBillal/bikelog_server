"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bikeRouter = void 0;
const express_1 = require("express");
const authCheck_1 = __importDefault(require("../../middleware/authCheck"));
const validateRequest_1 = __importDefault(require("../../middleware/validateRequest"));
const bike_controller_1 = require("./bike.controller");
const bike_validation_1 = require("./bike.validation");
const router = (0, express_1.Router)();
// ! for creating a bike
router.post("/", authCheck_1.default, (0, validateRequest_1.default)(bike_validation_1.bikeValidations.createBikeSchema), bike_controller_1.bikeController.createBike);
// ! for getting all bikes owned by the logged-in user
router.get("/", authCheck_1.default, bike_controller_1.bikeController.getBikes);
// ! for getting a single bike by id
router.get("/:id", authCheck_1.default, bike_controller_1.bikeController.getBikeById);
// ! for updating a bike
router.patch("/:id", authCheck_1.default, (0, validateRequest_1.default)(bike_validation_1.bikeValidations.updateBikeSchema), bike_controller_1.bikeController.updateBike);
// ! for deleting a bike
router.delete("/:id", authCheck_1.default, bike_controller_1.bikeController.deleteBike);
//
exports.bikeRouter = router;
