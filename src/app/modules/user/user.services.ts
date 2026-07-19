import argon2 from "argon2";
import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import { TUser, TJwtPayload } from "./user.interface";
import { userModel } from "./user.model";

import Jwt from "jsonwebtoken";
import config from "../../config";

// ! for creating a user
const createUser = async (payload: TUser) => {
  const result = await userModel.create(payload);

  return result;
};

// ! for login a user
type Tlogin = {
  email: string;
  password: string;
};
const loginFromDb = async (payload: Tlogin) => {
  const userData = await userModel.findOne({ email: payload?.email });

  if (!userData) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "User dont exist with this email !!!",
    );
  }

  const isPasswordMatch = await argon2.verify(
    userData?.password,
    payload?.password,
  );

  if (!isPasswordMatch) {
    throw new AppError(httpStatus.FORBIDDEN, "Password don't match !!");
  }

  const jwtPayload: TJwtPayload = {
    userId: userData?.id,
    userEmail: userData?.email,
    userRole: userData?.userRole,
  };

  const token = Jwt.sign(jwtPayload, config.jwt_secret as string, {
    expiresIn: config.jwt_expires_in as Jwt.SignOptions["expiresIn"],
  });


  return token
};

const getMeFromDb = async (userId: string) => {
  const result = await userModel.findById(userId).select("-password");

  if (!result) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  return result;
};

//
export const userServices = { createUser, loginFromDb, getMeFromDb };
