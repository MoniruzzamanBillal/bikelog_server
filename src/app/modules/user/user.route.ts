import { Router } from "express";
import validateRequest from "../../middleware/validateRequest";
import { userController } from "./user.controller";
import { userValidations } from "./user.validation";
import authCheck from "../../middleware/authCheck";
import { handleAvatarUpload } from "../../middleware/uploadAvatar";

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

// ! for exchanging a refresh token for a new access token (spec 51).
// ! No authCheck, and that omission is deliberate — the caller reaches this route precisely
// ! because its access token is expired, so requiring one would make the route unusable. The
// ! refresh token in the body IS the credential, verified in the service against its own
// ! secret. Same convention as notification.route.ts's cron routes, which document their own
// ! authCheck omission.
router.post(
  "/refresh-token",
  validateRequest(userValidations.refreshTokenSchema),
  userController.refreshToken,
);

// ! for getting current user
router.get(
  "/me",
  authCheck,
  userController.getMe,
);

// ! Spec 53 — for updating the logged-in user's own name. No user id in the path: the route
// ! acts on `req.user.userId`, so there is nothing to tamper with.
router.patch(
  "/update-profile",
  authCheck,
  validateRequest(userValidations.updateProfileSchema),
  userController.updateProfile,
);

// ! Spec 53 — for setting/replacing the logged-in user's profile picture. Multipart, one part
// ! named "image" (the house field name, as in bikeAccessory's image route).
// ! `handleAvatarUpload` goes AFTER `authCheck` on purpose, so an unauthenticated request is
// ! refused before anything is streamed to Cloudinary.
router.put(
  "/profile-picture",
  authCheck,
  handleAvatarUpload,
  userController.updateProfilePicture,
);

// ! Spec 53 — for removing the logged-in user's profile picture
router.delete(
  "/profile-picture",
  authCheck,
  userController.deleteProfilePicture,
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
