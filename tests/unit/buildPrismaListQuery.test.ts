import { describe, expect, it } from "vitest";
import { buildPrismaListQuery } from "../../src/app/builder/buildPrismaListQuery";

describe("buildPrismaListQuery", () => {
  it("applies the default sort and appends createdAt desc as a tie-breaker", () => {
    const result = buildPrismaListQuery({
      baseWhere: { bikeId: "b1", isDeleted: false },
      query: {},
      defaultSort: "date",
    });
    expect(result.orderBy).toEqual([{ date: "asc" }, { createdAt: "desc" }]);
    expect(result.where).toEqual({ bikeId: "b1", isDeleted: false });
    expect(result.skip).toBe(0);
    expect(result.take).toBe(10);
  });

  it("reads a leading '-' as descending", () => {
    const result = buildPrismaListQuery({
      baseWhere: {},
      query: { sort: "-date" },
      defaultSort: "date",
    });
    expect(result.orderBy).toEqual([{ date: "desc" }, { createdAt: "desc" }]);
  });

  it("splits a whitespace-separated multi-field sort (Mongoose-style)", () => {
    const result = buildPrismaListQuery({
      baseWhere: {},
      query: { sort: "status -dateReported" },
      defaultSort: "dateReported",
    });
    expect(result.orderBy).toEqual([
      { status: "asc" },
      { dateReported: "desc" },
      { createdAt: "desc" },
    ]);
  });

  it("splits a comma-separated multi-field sort", () => {
    const result = buildPrismaListQuery({
      baseWhere: {},
      query: { sort: "a,-b" },
      defaultSort: "a",
    });
    expect(result.orderBy).toEqual([
      { a: "asc" },
      { b: "desc" },
      { createdAt: "desc" },
    ]);
  });

  it("does not append createdAt twice when it is already in the sort", () => {
    const result = buildPrismaListQuery({
      baseWhere: {},
      query: { sort: "-createdAt" },
      defaultSort: "date",
    });
    expect(result.orderBy).toEqual([{ createdAt: "desc" }]);
  });

  it("computes skip/take from page and limit", () => {
    const result = buildPrismaListQuery({
      baseWhere: {},
      query: { page: "3", limit: "5" },
      defaultSort: "date",
    });
    expect(result.skip).toBe(10); // (3 - 1) * 5
    expect(result.take).toBe(5);
  });

  it("passes arbitrary equality filters through and strips the reserved keys", () => {
    const result = buildPrismaListQuery({
      baseWhere: { ownerId: "u1" },
      query: {
        status: "open",
        searchTerm: "ignored",
        sort: "date",
        limit: "10",
        page: "1",
        fields: "a,b",
      },
      defaultSort: "date",
    });
    expect(result.where).toEqual({ ownerId: "u1", status: "open" });
  });

  it("lets baseWhere and an extra filter coexist (baseWhere is the ownership scope)", () => {
    const result = buildPrismaListQuery({
      baseWhere: { bikeId: "b1", isDeleted: false },
      query: { status: "resolved" },
      defaultSort: "dateReported",
    });
    expect(result.where).toEqual({
      bikeId: "b1",
      isDeleted: false,
      status: "resolved",
    });
  });
});
