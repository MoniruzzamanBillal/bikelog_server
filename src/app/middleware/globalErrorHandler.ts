import { ErrorRequestHandler } from "express";
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

  // ! await'd, not fire-and-forget — on Vercel serverless a function invocation can be
  // ! torn down right after the response is flushed, so an un-awaited write issued after
  // ! res.json() below isn't guaranteed to actually complete. Self-contained try/catch:
  // ! a failure to log must never block or replace the real error response to the client.
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

  return res.status(status).json({
    success: false,
    message,
    errorSources,
    stack: error?.stack,
  });
};

export default globalErrorHandler;
