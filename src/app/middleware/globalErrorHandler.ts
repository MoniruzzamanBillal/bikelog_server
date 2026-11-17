import { Prisma } from "@prisma/client";
import { ErrorRequestHandler } from "express";
import httpStatus from "http-status";
import { ZodError } from "zod";
import AppError from "../Error/AppError";
import {
  handlePrismaKnownRequestError,
  handlePrismaValidationError,
} from "../Error/handlePrismaError";
import { handleZodError } from "../Error/handleZodError";
import { TerrorSource } from "../interface/error";
import { errorLogServices } from "../modules/errorLog/errorLog.service";

const globalErrorHandler: ErrorRequestHandler = async (
  error,
  req,
  res,
  // ! unused but required — Express only recognizes error-handling middleware by 4-argument arity
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next,
) => {
  let status = error.status || 500;
  let message = error.message || "Something went wrong!!";

  let errorSources: TerrorSource = [
    {
      path: "",
      message: "",
    },
  ];

  // ! One if/else-if chain, most specific first. The old handler was two separate chains
  // ! (the CastError `if` started a fresh one), which meant a Mongo CastError could silently
  // ! overwrite a Zod result — moot now those branches are gone, but the single chain is also
  // ! correct by construction. The three Mongoose-era branches (`name === "ValidationError"`,
  // ! `name === "CastError"`, Mongo's `code === 11000`) were deleted: none can fire under
  // ! Prisma/Postgres, and their handlers went with them.

  // ! Zod request-validation error (thrown by validateRequest before any service runs).
  if (error instanceof ZodError) {
    const simplifiedError = handleZodError(error);
    status = simplifiedError?.statusCode;
    message = simplifiedError?.message;
    errorSources = simplifiedError?.errorSources;
  }

  // ! A deliberate, domain-level error raised by a service/controller — it already carries
  // ! the status and message it wants, so trust them verbatim. Checked before the Prisma
  // ! branches because services catch Prisma errors they care about (e.g. P2002 on a catalog
  // ! name) and re-throw an AppError with a better message; only what they DON'T catch should
  // ! reach the generic Prisma mapper below.
  else if (error instanceof AppError) {
    status = error?.status;
    message = error?.message;
    errorSources = [{ path: "", message: error?.message }];
  }

  // ! Central Prisma error branch — the safety net for constraint errors no service caught.
  // ! P2002 → 409, P2025 → 404, P2003/P2000/P2011 → 400; anything else stays a logged 500.
  // ! Before this existed, P2003/P2025 fell through to the bare 500 default.
  else if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const simplifiedError = handlePrismaKnownRequestError(error);
    status = simplifiedError?.statusCode;
    message = simplifiedError?.message;
    errorSources = simplifiedError?.errorSources;
  }

  // ! Malformed query / wrong argument types reaching Prisma — a caller bug, so 400 not 500.
  else if (error instanceof Prisma.PrismaClientValidationError) {
    const simplifiedError = handlePrismaValidationError(error);
    status = simplifiedError?.statusCode;
    message = simplifiedError?.message;
    errorSources = simplifiedError?.errorSources;
  }

  // ! Spec 51 §E.1 — a 401 from the refresh-token route is NEVER logged. Its request body
  // ! holds a live 15-day credential, and `error_logs` is read back over HTTP by the admin
  // ! dashboard (web spec 26) and kept for 30 days. The refusal is also not information: the
  // ! route answers every failure cause with one identical message, by design.
  // ! Matched on the PATH, not the message — the message cannot distinguish anything, while
  // ! the path is exact. `originalUrl` (query stripped) rather than `req.path` because this
  // ! handler is app-mounted and `originalUrl` is what the row below stores anyway.
  // ! NOTE (§E.2): access-token 401s ARE still logged, deliberately. Nothing below may ever
  // ! be extended to carry the request body, headers or any token text — `TErrorLog` and the
  // ! `ErrorLog` model have no field for them today and must not gain one.
  const requestPath = (req.originalUrl || req.path || "").split("?")[0];
  const isRefreshTokenFailure =
    status === httpStatus.UNAUTHORIZED &&
    requestPath.endsWith("/auth/refresh-token");

  // ! await'd, not fire-and-forget — on Vercel serverless a function invocation can be
  // ! torn down right after the response is flushed, so an un-awaited write issued after
  // ! res.json() below isn't guaranteed to actually complete. Self-contained try/catch:
  // ! a failure to log must never block or replace the real error response to the client.
  if (!isRefreshTokenFailure) {
    try {
      await errorLogServices.createErrorLog({
        status,
        message,
        errorName: error?.name,
        errorSources,
        stack: error?.stack,
        method: req.method,
        path: req.originalUrl,
        userId: req.user?.userId ?? null,
        userEmail: req.user?.userEmail ?? null,
      });
    } catch (logError) {
      // eslint-disable-next-line no-console
      console.error("Failed to persist error log:", logError);
    }
  }

  return res.status(status).json({
    success: false,
    message,
    errorSources,
    stack: error?.stack,
  });
};

export default globalErrorHandler;
