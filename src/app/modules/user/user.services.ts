import argon2 from "argon2";
import { Prisma } from "@prisma/client";
import httpStatus from "http-status";
import Jwt from "jsonwebtoken";
import AppError from "../../Error/AppError";
import config from "../../config";
import { prisma } from "../../lib/prisma";
import { generateObjectId } from "../../util/generateObjectId";
import { TUser, TJwtPayload } from "./user.interface";

// every field except `password`, so a newly-added sensitive field never leaks by accident
const safeUserSelect = {
  id: true,
  name: true,
  email: true,
  isDeleted: true,
  userRole: true,
  expoPushToken: true,
  createdAt: true,
  updatedAt: true,
} as const;

// ! for creating a user
const createUser = async (payload: TUser) => {
  try {
    const hashedPassword = await argon2.hash(payload.password);

    const result = await prisma.user.create({
      data: {
        id: generateObjectId(),
        name: payload.name,
        email: payload.email,
        password: hashedPassword,
      },
      select: safeUserSelect,
    });

    return { ...result, _id: result.id };
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new AppError(
        httpStatus.CONFLICT,
        "A user with this email already exists",
      );
    }
    throw error;
  }
};

// ! for login a user
type Tlogin = {
  email: string;
  password: string;
};
const loginFromDb = async (payload: Tlogin) => {
  const userData = await prisma.user.findUnique({
    where: { email: payload?.email },
  });

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
    userRole: userData?.userRole as TJwtPayload["userRole"],
  };

  const token = Jwt.sign(jwtPayload, config.jwt_secret as string, {
    expiresIn: config.jwt_expires_in as Jwt.SignOptions["expiresIn"],
  });

  return token;
};

const getMeFromDb = async (userId: string) => {
  const result = await prisma.user.findUnique({
    where: { id: userId },
    select: safeUserSelect,
  });

  if (!result) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  return { ...result, _id: result.id };
};

// ! registers/updates this device's Expo push token, feeding the weekly-summary cron job
const updatePushToken = async (userId: string, expoPushToken: string) => {
  const existing = await prisma.user.findUnique({ where: { id: userId } });

  if (!existing) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  const result = await prisma.user.update({
    where: { id: userId },
    data: { expoPushToken },
    select: safeUserSelect,
  });

  return { ...result, _id: result.id };
};

//
export const userServices = {
  createUser,
  loginFromDb,
  getMeFromDb,
  updatePushToken,
};
