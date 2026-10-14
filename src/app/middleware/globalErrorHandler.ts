import { ErrorRequestHandler } from "express";
import httpStatus from "http-status";
import { ZodError } from "zod";
import AppError from "../Error/AppError";
import { handleCastError } from "../Error/handleCatError";
import { handleDuplicateError } from "../Error/handleDuplicateError";
import { handleValidationError } from "../Error/handleValidationError";
import { handleZodError } from "../Error/handleZodError";
import { TerrorSource } from "../interface/error";
import { errorLogServices } from "../modules/errorLog/errorLog.service";

const globalErrorHandler: ErrorRequestHandler = async (
  error,
  req,
  res,
  // ! unused but required — Express only recognizes error-handling middleware by 4-argument arity
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next
) => {
  let status = error.status || 500;
  let message = error.message || "Something went wrong!!";

  let errorSources: TerrorSource = [
    {
      path: "",
      message: "",
    },
  ];

  // ! zod validation error
  if (error instanceof ZodError) {
    const simplifiedError = handleZodError(error);
    status = simplifiedError?.statusCode;
    message = simplifiedError?.message;
    errorSources = simplifiedError?.errorSources;
  }

  // ! mongoose validation error
  else if (error?.name === "ValidationError") {
    const simplifiedError = handleValidationError(error);
    status = simplifiedError?.statusCode;
    message = simplifiedError?.message;
    errorSources = simplifiedError?.errorSources;
  }

  // ! cast error
  if (error?.name === "CastError") {
    const simplifiedError = handleCastError(error);
    status = simplifiedError?.statusCode;
    message = simplifiedError?.message;
    errorSources = simplifiedError?.errorSources;
  }

  // ! handle duplicate error
  else if (error?.code === 11000) {
    const simplifiedError = handleDuplicateError(error);
    status = simplifiedError?.statusCode;
    message = simplifiedError?.message;
    errorSources = simplifiedError?.errorSources;
  }

  // ! handle custom app error
  else if (error instanceof AppError) {
    status = error?.status;
    message = error?.message;
    errorSources = [{ path: "", message: error?.message }];
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
