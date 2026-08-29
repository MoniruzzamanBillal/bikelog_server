import httpStatus from "http-status";
import AppError from "../Error/AppError";
import catchAsync from "../util/catchAsync";
import { UserRole } from "../modules/user/user.interface";

// ! must run after authCheck — reads req.user, which authCheck populates
const adminCheck = catchAsync(async (req, res, next) => {
  if (req.user?.userRole !== UserRole.admin) {
    return next(new AppError(httpStatus.FORBIDDEN, "Admin access required"));
  }

  next();
});

export default adminCheck;
