"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const http_status_1 = __importDefault(require("http-status"));
const zod_1 = require("zod");
const AppError_1 = __importDefault(require("../Error/AppError"));
const handlePrismaError_1 = require("../Error/handlePrismaError");
const handleZodError_1 = require("../Error/handleZodError");
const errorLog_service_1 = require("../modules/errorLog/errorLog.service");
const globalErrorHandler = (error, req, res, 
// ! unused but required — Express only recognizes error-handling middleware by 4-argument arity
// eslint-disable-next-line @typescript-eslint/no-unused-vars
next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    let status = error.status || 500;
    let message = error.message || "Something went wrong!!";
    let errorSources = [
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
    if (error instanceof zod_1.ZodError) {
        const simplifiedError = (0, handleZodError_1.handleZodError)(error);
        status = simplifiedError === null || simplifiedError === void 0 ? void 0 : simplifiedError.statusCode;
        message = simplifiedError === null || simplifiedError === void 0 ? void 0 : simplifiedError.message;
        errorSources = simplifiedError === null || simplifiedError === void 0 ? void 0 : simplifiedError.errorSources;
    }
    // ! A deliberate, domain-level error raised by a service/controller — it already carries
    // ! the status and message it wants, so trust them verbatim. Checked before the Prisma
    // ! branches because services catch Prisma errors they care about (e.g. P2002 on a catalog
    // ! name) and re-throw an AppError with a better message; only what they DON'T catch should
    // ! reach the generic Prisma mapper below.
    else if (error instanceof AppError_1.default) {
        status = error === null || error === void 0 ? void 0 : error.status;
        message = error === null || error === void 0 ? void 0 : error.message;
        errorSources = [{ path: "", message: error === null || error === void 0 ? void 0 : error.message }];
    }
    // ! Central Prisma error branch — the safety net for constraint errors no service caught.
    // ! P2002 → 409, P2025 → 404, P2003/P2000/P2011 → 400; anything else stays a logged 500.
    // ! Before this existed, P2003/P2025 fell through to the bare 500 default.
    else if (error instanceof client_1.Prisma.PrismaClientKnownRequestError) {
        const simplifiedError = (0, handlePrismaError_1.handlePrismaKnownRequestError)(error);
        status = simplifiedError === null || simplifiedError === void 0 ? void 0 : simplifiedError.statusCode;
        message = simplifiedError === null || simplifiedError === void 0 ? void 0 : simplifiedError.message;
        errorSources = simplifiedError === null || simplifiedError === void 0 ? void 0 : simplifiedError.errorSources;
    }
    // ! Malformed query / wrong argument types reaching Prisma — a caller bug, so 400 not 500.
    else if (error instanceof client_1.Prisma.PrismaClientValidationError) {
        const simplifiedError = (0, handlePrismaError_1.handlePrismaValidationError)(error);
        status = simplifiedError === null || simplifiedError === void 0 ? void 0 : simplifiedError.statusCode;
        message = simplifiedError === null || simplifiedError === void 0 ? void 0 : simplifiedError.message;
        errorSources = simplifiedError === null || simplifiedError === void 0 ? void 0 : simplifiedError.errorSources;
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
    const isRefreshTokenFailure = status === http_status_1.default.UNAUTHORIZED &&
        requestPath.endsWith("/auth/refresh-token");
    // ! await'd, not fire-and-forget — on Vercel serverless a function invocation can be
    // ! torn down right after the response is flushed, so an un-awaited write issued after
    // ! res.json() below isn't guaranteed to actually complete. Self-contained try/catch:
    // ! a failure to log must never block or replace the real error response to the client.
    if (!isRefreshTokenFailure) {
        try {
            yield errorLog_service_1.errorLogServices.createErrorLog({
                status,
                message,
                errorName: error === null || error === void 0 ? void 0 : error.name,
                errorSources,
                stack: error === null || error === void 0 ? void 0 : error.stack,
                method: req.method,
                path: req.originalUrl,
                userId: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.userId) !== null && _b !== void 0 ? _b : null,
                userEmail: (_d = (_c = req.user) === null || _c === void 0 ? void 0 : _c.userEmail) !== null && _d !== void 0 ? _d : null,
            });
        }
        catch (logError) {
            // eslint-disable-next-line no-console
            console.error("Failed to persist error log:", logError);
        }
    }
    return res.status(status).json({
        success: false,
        message,
        errorSources,
        stack: error === null || error === void 0 ? void 0 : error.stack,
    });
});
exports.default = globalErrorHandler;
