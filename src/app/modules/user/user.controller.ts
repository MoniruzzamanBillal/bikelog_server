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
    data: null ,
    token: result,
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

//
export const userController = {
  createUser,
  signIn,
  getMe,
};
