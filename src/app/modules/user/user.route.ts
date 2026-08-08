import { Router } from "express";
import validateRequest from "../../middleware/validateRequest";
import { userController } from "./user.controller";
import { userValidations } from "./user.validation";
import authCheck from "../../middleware/authCheck";

const router = Router();

// ! for registering a user
router.post(
  "/register",
  validateRequest(userValidations.createUserSchema),
  userController.createUser,
);

// ! for login
router.post(
  "/login",
  validateRequest(userValidations.loginValidationSchema),
  userController.signIn,
);

// ! for getting current user
router.get(
  "/me",
  authCheck,
  userController.getMe,
);

// ! for registering/updating this device's Expo push token
router.post(
  "/push-token",
  authCheck,
  validateRequest(userValidations.pushTokenSchema),
  userController.updatePushToken,
);

//
export const userRouter = router;
