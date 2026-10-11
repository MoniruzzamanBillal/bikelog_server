import httpStatus from "http-status";
import Jwt from "jsonwebtoken";
import config from "../config";
import AppError from "../Error/AppError";
import catchAsync from "../util/catchAsync";
import {
  TJwtPayload,
  TVerifiedTokenClaims,
} from "../modules/user/user.interface";

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

  // ! Spec 51a: verified into the WIDER claims type, not TJwtPayload. The caller supplies the
  // ! token, so `type` is an arbitrary string until checked below — asserting it as the
  // ! "access" literal this server mints would make that check provably dead code (it did:
  // ! TS2367), while compiling the check away would leave H4 unenforced at runtime.
  let decoded: TVerifiedTokenClaims;
  try {
    decoded = Jwt.verify(
      token,
      config.jwt_secret as string,
    ) as TVerifiedTokenClaims;
  } catch (error) {
    // ! Spec 51: both branches are still 401, so no client behaviour changes — but the message
    // ! now tells an expired token apart from a malformed one, which is what the clients' 401
    // ! handling and the error log are read against. An expired access token is the routine
    // ! case now (15-minute lifetime), not a fault.
    return next(
      new AppError(
        httpStatus.UNAUTHORIZED,
        error instanceof Jwt.TokenExpiredError
          ? "Access token expired"
          : "Invalid access token",
      ),
    );
  }

  // ! Spec 51 §0 H4: a refresh token must never authenticate a request. It verifies with a
  // ! different secret so it would normally fail above, but this is the explicit second half
  // ! of that defence and it costs nothing. A MISSING `type` passes deliberately (H8) —
  // ! tokens issued before spec 51 have no such claim and must keep working until they expire.
  if (decoded?.type === "refresh") {
    return next(new AppError(httpStatus.UNAUTHORIZED, "Invalid access token"));
  }

  // ! Sound only because the check above ruled out the one `type` value TJwtPayload must
  // ! never carry (spec 51a).
  req.user = decoded as TJwtPayload;
  next();
});

export default authCheck;
