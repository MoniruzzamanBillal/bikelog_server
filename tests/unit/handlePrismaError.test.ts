import { Prisma } from "@prisma/client";
import httpStatus from "http-status";
import { describe, expect, it } from "vitest";
import {
  handlePrismaKnownRequestError,
  handlePrismaValidationError,
} from "../../src/app/Error/handlePrismaError";

// Build a real PrismaClientKnownRequestError the way Prisma itself throws them, so the mapper
// is exercised against the actual shape (code + meta), not a hand-faked object.
const knownError = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError("boom", {
    code,
    clientVersion: "7.10.0",
    meta,
  });

describe("handlePrismaKnownRequestError", () => {
  it("maps P2002 (unique) to 409 and names the array target field", () => {
    const result = handlePrismaKnownRequestError(
      knownError("P2002", { target: ["email"] }),
    );
    expect(result.statusCode).toBe(httpStatus.CONFLICT);
    expect(result.message).toContain("email");
    expect(result.errorSources[0].path).toBe("email");
  });

  it("maps P2002 with a string target (the constraint name)", () => {
    const result = handlePrismaKnownRequestError(
      knownError("P2002", { target: "users_email_key" }),
    );
    expect(result.statusCode).toBe(httpStatus.CONFLICT);
    expect(result.message).toContain("users_email_key");
  });

  it("falls back to 'value' when P2002 has no target meta", () => {
    const result = handlePrismaKnownRequestError(knownError("P2002"));
    expect(result.statusCode).toBe(httpStatus.CONFLICT);
    expect(result.message).toContain("value");
  });

  it("maps P2025 (not found) to 404 and surfaces meta.cause", () => {
    const result = handlePrismaKnownRequestError(
      knownError("P2025", { cause: "Record to update not found." }),
    );
    expect(result.statusCode).toBe(httpStatus.NOT_FOUND);
    expect(result.message).toBe("Record to update not found.");
  });

  it("maps P2025 with no meta to 404 with a default message", () => {
    const result = handlePrismaKnownRequestError(knownError("P2025"));
    expect(result.statusCode).toBe(httpStatus.NOT_FOUND);
    expect(result.message).toBe("The requested record was not found");
  });

  it("maps P2003 (foreign key) to 400 and carries the field name", () => {
    const result = handlePrismaKnownRequestError(
      knownError("P2003", { field_name: "maintenance_logs_oilTypeId_fkey" }),
    );
    expect(result.statusCode).toBe(httpStatus.BAD_REQUEST);
    expect(result.errorSources[0].path).toBe(
      "maintenance_logs_oilTypeId_fkey",
    );
  });

  it("maps P2000 (value too long) to 400", () => {
    const result = handlePrismaKnownRequestError(
      knownError("P2000", { column_name: "nickname" }),
    );
    expect(result.statusCode).toBe(httpStatus.BAD_REQUEST);
    expect(result.errorSources[0].path).toBe("nickname");
  });

  it("maps P2011 (null constraint) to 400", () => {
    const result = handlePrismaKnownRequestError(
      knownError("P2011", { constraint: "ownerId" }),
    );
    expect(result.statusCode).toBe(httpStatus.BAD_REQUEST);
  });

  it("keeps an unknown known-code as a logged 500 that surfaces the code", () => {
    const result = handlePrismaKnownRequestError(knownError("P2010"));
    expect(result.statusCode).toBe(httpStatus.INTERNAL_SERVER_ERROR);
    expect(result.message).toContain("P2010");
  });
});

describe("handlePrismaValidationError", () => {
  it("maps a validation error to 400", () => {
    const result = handlePrismaValidationError(
      new Prisma.PrismaClientValidationError("bad args", {
        clientVersion: "7.10.0",
      }),
    );
    expect(result.statusCode).toBe(httpStatus.BAD_REQUEST);
    expect(result.message).toBe("Invalid data provided to the database query");
  });
});
