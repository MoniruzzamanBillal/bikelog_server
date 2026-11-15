"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handlePrismaValidationError = exports.handlePrismaKnownRequestError = void 0;
const http_status_1 = __importDefault(require("http-status"));
// ! Central Prisma error mapper — the Postgres/Prisma replacement for the deleted Mongoose-era
// ! handlers (handleCastError / handleValidationError / handleDuplicateError), which keyed off
// ! `error.name === "CastError" | "ValidationError"` and Mongo's `code === 11000` and so could
// ! never fire under Prisma. Services still catch P2002 locally where a domain-specific message
// ! is worth having (user / maintenanceType / engineOilType, all → 409 CONFLICT); this is the
// ! safety net for every Prisma error that reaches the global handler uncaught. Before it,
// ! P2003 (FK) and P2025 (record not found) — and any stray P2002 — fell through to a bare 500.
const toSource = (path, message) => [
    { path, message },
];
// ! `error.meta` is `Record<string, unknown> | undefined`; each code documents its own keys,
// ! but they are untyped, so read defensively and always fall back to a generic message.
const handlePrismaKnownRequestError = (error) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    switch (error === null || error === void 0 ? void 0 : error.code) {
        // Unique constraint violation. `meta.target` is the offending column(s). 409 so the
        // clients read it as "the server refused" (the app paints 409s amber), matching how the
        // services' own P2002 catches already respond.
        case "P2002": {
            const target = (_a = error.meta) === null || _a === void 0 ? void 0 : _a.target;
            const fields = Array.isArray(target)
                ? target.join(", ")
                : (target !== null && target !== void 0 ? target : "value");
            return {
                statusCode: http_status_1.default.CONFLICT,
                message: `A record with this ${fields} already exists`,
                errorSources: toSource(Array.isArray(target) ? ((_b = target[0]) !== null && _b !== void 0 ? _b : "") : "", `${fields} must be unique`),
            };
        }
        // An operation (update/delete/connect) required a row that does not exist.
        case "P2025": {
            const cause = (_d = (_c = error.meta) === null || _c === void 0 ? void 0 : _c.cause) !== null && _d !== void 0 ? _d : "The requested record was not found";
            return {
                statusCode: http_status_1.default.NOT_FOUND,
                message: cause,
                errorSources: toSource("", cause),
            };
        }
        // Foreign-key constraint failed — a referenced row is missing, or the row is still
        // referenced by another table and cannot be deleted.
        case "P2003": {
            const field = (_f = (_e = error.meta) === null || _e === void 0 ? void 0 : _e.field_name) !== null && _f !== void 0 ? _f : "";
            return {
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "Related record constraint failed — the referenced record is missing or still in use",
                errorSources: toSource(field, "foreign key constraint failed"),
            };
        }
        // A provided value is longer than the column allows.
        case "P2000": {
            const column = (_h = (_g = error.meta) === null || _g === void 0 ? void 0 : _g.column_name) !== null && _h !== void 0 ? _h : "";
            return {
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "A provided value is too long for one of the fields",
                errorSources: toSource(column, "value exceeds the column's maximum length"),
            };
        }
        // Null constraint violation on a required column.
        case "P2011": {
            const constraint = String((_k = (_j = error.meta) === null || _j === void 0 ? void 0 : _j.constraint) !== null && _k !== void 0 ? _k : "");
            return {
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "A required value is missing",
                errorSources: toSource(constraint, "null constraint violation"),
            };
        }
        // Any other known Prisma error: keep a 500 so it is noticed and logged, but surface the
        // code rather than a blank "Something went wrong". Only the last line of Prisma's multi-
        // line message is useful to a client.
        default: {
            return {
                statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
                message: `Database error (${error === null || error === void 0 ? void 0 : error.code})`,
                errorSources: toSource("", (_o = (_m = (_l = error === null || error === void 0 ? void 0 : error.message) === null || _l === void 0 ? void 0 : _l.split("\n")) === null || _m === void 0 ? void 0 : _m.pop()) !== null && _o !== void 0 ? _o : error === null || error === void 0 ? void 0 : error.message),
            };
        }
    }
};
exports.handlePrismaKnownRequestError = handlePrismaKnownRequestError;
// Malformed query / wrong argument types reaching Prisma (as opposed to a constraint the DB
// rejected). These are caller bugs, not server faults → 400 rather than 500.
const handlePrismaValidationError = (error) => {
    var _a, _b, _c;
    return ({
        statusCode: http_status_1.default.BAD_REQUEST,
        message: "Invalid data provided to the database query",
        errorSources: toSource("", (_c = (_b = (_a = error === null || error === void 0 ? void 0 : error.message) === null || _a === void 0 ? void 0 : _a.split("\n")) === null || _b === void 0 ? void 0 : _b.pop()) !== null && _c !== void 0 ? _c : "validation error"),
    });
};
exports.handlePrismaValidationError = handlePrismaValidationError;
