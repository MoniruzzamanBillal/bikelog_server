import { Prisma } from "@prisma/client";
import httpStatus from "http-status";
import { TerrorSource, TgenericResponse } from "../interface/error";

// ! Central Prisma error mapper — the Postgres/Prisma replacement for the deleted Mongoose-era
// ! handlers (handleCastError / handleValidationError / handleDuplicateError), which keyed off
// ! `error.name === "CastError" | "ValidationError"` and Mongo's `code === 11000` and so could
// ! never fire under Prisma. Services still catch P2002 locally where a domain-specific message
// ! is worth having (user / maintenanceType / engineOilType, all → 409 CONFLICT); this is the
// ! safety net for every Prisma error that reaches the global handler uncaught. Before it,
// ! P2003 (FK) and P2025 (record not found) — and any stray P2002 — fell through to a bare 500.

const toSource = (path: string | number, message: string): TerrorSource => [
  { path, message },
];

// ! `error.meta` is `Record<string, unknown> | undefined`; each code documents its own keys,
// ! but they are untyped, so read defensively and always fall back to a generic message.
export const handlePrismaKnownRequestError = (
  error: Prisma.PrismaClientKnownRequestError,
): TgenericResponse => {
  switch (error?.code) {
    // Unique constraint violation. `meta.target` is the offending column(s). 409 so the
    // clients read it as "the server refused" (the app paints 409s amber), matching how the
    // services' own P2002 catches already respond.
    case "P2002": {
      const target = error.meta?.target as string[] | string | undefined;
      const fields = Array.isArray(target)
        ? target.join(", ")
        : (target ?? "value");
      return {
        statusCode: httpStatus.CONFLICT,
        message: `A record with this ${fields} already exists`,
        errorSources: toSource(
          Array.isArray(target) ? (target[0] ?? "") : "",
          `${fields} must be unique`,
        ),
      };
    }

    // An operation (update/delete/connect) required a row that does not exist.
    case "P2025": {
      const cause =
        (error.meta?.cause as string | undefined) ??
        "The requested record was not found";
      return {
        statusCode: httpStatus.NOT_FOUND,
        message: cause,
        errorSources: toSource("", cause),
      };
    }

    // Foreign-key constraint failed — a referenced row is missing, or the row is still
    // referenced by another table and cannot be deleted.
    case "P2003": {
      const field = (error.meta?.field_name as string | undefined) ?? "";
      return {
        statusCode: httpStatus.BAD_REQUEST,
        message:
          "Related record constraint failed — the referenced record is missing or still in use",
        errorSources: toSource(field, "foreign key constraint failed"),
      };
    }

    // A provided value is longer than the column allows.
    case "P2000": {
      const column = (error.meta?.column_name as string | undefined) ?? "";
      return {
        statusCode: httpStatus.BAD_REQUEST,
        message: "A provided value is too long for one of the fields",
        errorSources: toSource(
          column,
          "value exceeds the column's maximum length",
        ),
      };
    }

    // Null constraint violation on a required column.
    case "P2011": {
      const constraint = String(error.meta?.constraint ?? "");
      return {
        statusCode: httpStatus.BAD_REQUEST,
        message: "A required value is missing",
        errorSources: toSource(constraint, "null constraint violation"),
      };
    }

    // Any other known Prisma error: keep a 500 so it is noticed and logged, but surface the
    // code rather than a blank "Something went wrong". Only the last line of Prisma's multi-
    // line message is useful to a client.
    default: {
      return {
        statusCode: httpStatus.INTERNAL_SERVER_ERROR,
        message: `Database error (${error?.code})`,
        errorSources: toSource(
          "",
          error?.message?.split("\n")?.pop() ?? error?.message,
        ),
      };
    }
  }
};

// Malformed query / wrong argument types reaching Prisma (as opposed to a constraint the DB
// rejected). These are caller bugs, not server faults → 400 rather than 500.
export const handlePrismaValidationError = (
  error: Prisma.PrismaClientValidationError,
): TgenericResponse => ({
  statusCode: httpStatus.BAD_REQUEST,
  message: "Invalid data provided to the database query",
  errorSources: toSource(
    "",
    error?.message?.split("\n")?.pop() ?? "validation error",
  ),
});
