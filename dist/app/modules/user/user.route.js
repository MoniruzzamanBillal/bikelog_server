"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.userRouter = void 0;
const express_1 = require("express");
const validateRequest_1 = __importDefault(require("../../middleware/validateRequest"));
const user_controller_1 = require("./user.controller");
const user_validation_1 = require("./user.validation");
const authCheck_1 = __importDefault(require("../../middleware/authCheck"));
const router = (0, express_1.Router)();
// ! for registering a user
router.post("/register", (0, validateRequest_1.default)(user_validation_1.userValidations.createUserSchema), user_controller_1.userController.createUser);
// ! for login
router.post("/login", (0, validateRequest_1.default)(user_validation_1.userValidations.loginValidationSchema), user_controller_1.userController.signIn);
// ! for getting current user
router.get("/me", authCheck_1.default, user_controller_1.userController.getMe);
//
exports.userRouter = router;
