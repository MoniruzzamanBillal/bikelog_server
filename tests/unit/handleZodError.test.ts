import httpStatus from "http-status";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handleZodError } from "../../src/app/Error/handleZodError";

// The real validateRequest path wraps the body in an outer object; mirror that so the
// path-flattening (last segment only) is what's asserted.
const schema = z.object({
  body: z.object({
    odometerReading: z.number().max(999999),
    nickname: z.string().min(1),
  }),
});

const zodErrorFrom = (data: unknown) => {
  const parsed = schema.safeParse(data);
  if (parsed.success) {
    throw new Error("expected the schema to reject this fixture");
  }
  return parsed.error;
};

describe("handleZodError", () => {
  it("maps a ZodError to 400", () => {
    const result = handleZodError(
      zodErrorFrom({ body: { odometerReading: 1, nickname: "" } }),
    );
    expect(result.statusCode).toBe(httpStatus.BAD_REQUEST);
  });

  it("flattens each issue's path to its last segment", () => {
    const result = handleZodError(
      zodErrorFrom({ body: { odometerReading: "x", nickname: "ok" } }),
    );
    // only odometerReading is invalid here (wrong type)
    expect(result.errorSources).toHaveLength(1);
    expect(result.errorSources[0].path).toBe("odometerReading");
    expect(typeof result.errorSources[0].message).toBe("string");
  });

  it("reports one errorSource per failing field", () => {
    const result = handleZodError(
      zodErrorFrom({ body: { odometerReading: 10_000_000, nickname: "" } }),
    );
    const paths = result.errorSources.map((s) => s.path);
    expect(paths).toContain("odometerReading");
    expect(paths).toContain("nickname");
  });
});
