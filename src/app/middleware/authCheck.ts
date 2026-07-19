import httpStatus from "http-status";
import Jwt from "jsonwebtoken";
import config from "../config";
import AppError from "../Error/AppError";
import catchAsync from "../util/catchAsync";
import { TJwtPayload } from "../modules/user/user.interface";

const authCheck = catchAsync(async (req, res, next) => {
  const header = req.headers.authorization;

  if (!header) {
    return next(
      new AppError(
        httpStatus.UNAUTHORIZED,
        "Authorization header missing or malformed",
      ),
    );
  }

  const token = header.split(" ")[1];

  let decoded: TJwtPayload;
  try {
    decoded = Jwt.verify(token, config.jwt_secret as string) as TJwtPayload;
  } catch (error) {
    return next(
      new AppError(
        httpStatus.UNAUTHORIZED,
        "Token expired , Please login to continue",
      ),
    );
  }

  req.user = decoded;
  next();
});

export default authCheck;
