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
const uploadAvatar_1 = require("../../middleware/uploadAvatar");
const router = (0, express_1.Router)();
// ! for registering a user
router.post("/register", (0, validateRequest_1.default)(user_validation_1.userValidations.createUserSchema), user_controller_1.userController.createUser);
// ! for login
router.post("/login", (0, validateRequest_1.default)(user_validation_1.userValidations.loginValidationSchema), user_controller_1.userController.signIn);
// ! for exchanging a refresh token for a new access token (spec 51).
// ! No authCheck, and that omission is deliberate — the caller reaches this route precisely
// ! because its access token is expired, so requiring one would make the route unusable. The
// ! refresh token in the body IS the credential, verified in the service against its own
// ! secret. Same convention as notification.route.ts's cron routes, which document their own
// ! authCheck omission.
router.post("/refresh-token", (0, validateRequest_1.default)(user_validation_1.userValidations.refreshTokenSchema), user_controller_1.userController.refreshToken);
// ! for getting current user
router.get("/me", authCheck_1.default, user_controller_1.userController.getMe);
// ! Spec 53 — for updating the logged-in user's own name. No user id in the path: the route
// ! acts on `req.user.userId`, so there is nothing to tamper with.
// ! Spec 55 — `name` is the ONLY writable field here. A submitted `email` is refused with a
// ! 400 by the schema (it used to be stripped silently, which answered 200 and changed
// ! nothing), and the service writes `data: { name }` only. The email is the login
// ! identifier and is not editable by its owner through this API at all.
router.patch("/update-profile", authCheck_1.default, (0, validateRequest_1.default)(user_validation_1.userValidations.updateProfileSchema), user_controller_1.userController.updateProfile);
// ! Spec 53 — for setting/replacing the logged-in user's profile picture. Multipart, one part
// ! named "image" (the house field name, as in bikeAccessory's image route).
// ! `handleAvatarUpload` goes AFTER `authCheck` on purpose, so an unauthenticated request is
// ! refused before anything is streamed to Cloudinary.
router.put("/profile-picture", authCheck_1.default, uploadAvatar_1.handleAvatarUpload, user_controller_1.userController.updateProfilePicture);
// ! Spec 53 — for removing the logged-in user's profile picture
router.delete("/profile-picture", authCheck_1.default, user_controller_1.userController.deleteProfilePicture);
// ! for registering/updating this device's Expo push token
router.post("/push-token", authCheck_1.default, (0, validateRequest_1.default)(user_validation_1.userValidations.pushTokenSchema), user_controller_1.userController.updatePushToken);
//
exports.userRouter = router;
