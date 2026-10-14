import httpStatus from "http-status";
import catchAsync from "../../util/catchAsync";
import sendResponse from "../../util/sendResponse";
import { userServices } from "./user.services";

// ! for creating a user
const createUser = catchAsync(async (req, res) => {
  const result = await userServices.createUser(req.body);

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "User created successfully!!!",
    data: result,
  });
});

// ! for login
const signIn = catchAsync(async (req, res) => {
  const result = await userServices.loginFromDb(req.body);

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "User logged in successfully!!!",
    data: null,
    // ! Spec 51: `token` keeps meaning the ACCESS token. That is the whole back-compat story
    // ! (its §0 H1) — pre-spec-51 clients read `result.token` and ignore the new sibling.
    token: result?.accessToken,
    refreshToken: result?.refreshToken,
  });
});

// ! Spec 51 — for exchanging a valid refresh token for a new access token. The refresh token
// ! is NOT echoed back: it is unchanged, so there is nothing for the client to re-store.
const refreshToken = catchAsync(async (req, res) => {
  const result = await userServices.refreshAccessToken(req.body?.refreshToken);

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Access token refreshed successfully!!!",
    data: null,
    token: result?.accessToken,
  });
});

// ! for getting current user
const getMe = catchAsync(async (req, res) => {
  const result = await userServices.getMeFromDb(req.user.userId);

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "User retrieved successfully!!!",
    data: result,
  });
});

// ! for registering/updating this device's Expo push token
const updatePushToken = catchAsync(async (req, res) => {
  const result = await userServices.updatePushToken(
    req.user.userId,
    req.body.expoPushToken,
  );

  sendResponse(res, {
    status: httpStatus.OK,
    success: true,
    message: "Push token updated successfully!!!",
    data: result,
  });
});

//
export const userController = {
  createUser,
  signIn,
  refreshToken,
  getMe,
  updatePushToken,
};
