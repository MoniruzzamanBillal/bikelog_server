import { describe, expect, it } from "vitest";
import {
  deriveStatus,
  dueState,
  nextWarrantyNumber,
  summarizeWarranty,
  sumItemCosts,
} from "../../src/app/modules/serviceLog/serviceLog.pure";

// Spec 67 — pure, DB-free helpers for the Service Log module. Mirrors the repo's existing
// DB-free suite (the PrismaNeon adapter can't use local Postgres, so nothing prisma-calling
// is tested here). These import from serviceLog.pure, which has no Prisma import.

describe("sumItemCosts", () => {
  it("returns 0 for no items", () => {
    expect(sumItemCosts(undefined)).toBe(0);
    expect(sumItemCosts(null)).toBe(0);
    expect(sumItemCosts([])).toBe(0);
  });

  it("sums item costs and rounds to 2dp", () => {
    expect(
      sumItemCosts([
        { name: "carbon cleaner", cost: 300 },
        { name: "oil top-up", cost: 150.5 },
      ]),
    ).toBe(450.5);
  });

  it("treats a missing or non-finite cost as 0 (a free item)", () => {
    expect(
      sumItemCosts([
        { name: "free check" },
        { name: "coolant", cost: 200 },
        { name: "bad", cost: Infinity },
      ]),
    ).toBe(200);
  });

  it("avoids float drift (0.1 + 0.2 → 0.3, not 0.30000000000000004)", () => {
    expect(
      sumItemCosts([
        { name: "a", cost: 0.1 },
        { name: "b", cost: 0.2 },
      ]),
    ).toBe(0.3);
  });
});

describe("nextWarrantyNumber", () => {
  it("is one past the existing warranty count", () => {
    expect(nextWarrantyNumber(0)).toBe(1);
    expect(nextWarrantyNumber(4)).toBe(5);
  });

  it("does not clamp at 5 (a 6th warranty service reads as #6)", () => {
    expect(nextWarrantyNumber(5)).toBe(6);
  });
});

describe("deriveStatus", () => {
  it("is completed once a service date exists", () => {
    expect(deriveStatus(new Date())).toBe("completed");
  });

  it("is upcoming with no service date", () => {
    expect(deriveStatus(undefined)).toBe("upcoming");
    expect(deriveStatus(null)).toBe("upcoming");
  });
});

describe("dueState", () => {
  const now = new Date("2026-02-15T00:00:00.000Z");

  it("is overdue when the due date is in the past", () => {
    expect(dueState(new Date("2026-02-10T00:00:00.000Z"), now)).toBe("overdue");
  });

  it("is upcoming when the due date is in the future", () => {
    expect(dueState(new Date("2026-02-20T00:00:00.000Z"), now)).toBe(
      "upcoming",
    );
  });

  it("treats exactly-now as upcoming (not yet past)", () => {
    expect(dueState(new Date(now), now)).toBe("upcoming");
  });
});

describe("summarizeWarranty", () => {
  const now = new Date("2026-02-15T00:00:00.000Z");

  it("reports warranty progress and the earliest upcoming dates", () => {
    const summary = summarizeWarranty(
      [
        {
          serviceKind: "warranty",
          status: "completed",
          warrantyNumber: 1,
          dueDate: new Date("2025-11-15T00:00:00.000Z"),
        },
        {
          serviceKind: "warranty",
          status: "upcoming",
          warrantyNumber: 2,
          dueDate: new Date("2026-03-01T00:00:00.000Z"),
        },
        {
          serviceKind: "regular",
          status: "upcoming",
          warrantyNumber: null,
          dueDate: new Date("2026-02-18T00:00:00.000Z"),
        },
      ],
      now,
    );

    expect(summary.warrantyTotal).toBe(5);
    expect(summary.warrantyCompleted).toBe(1);
    expect(summary.warrantyLogged).toBe(2);
    // earliest upcoming of ANY kind is the regular one on 18 Feb
    expect(summary.nextService?.dueDate.toISOString()).toBe(
      "2026-02-18T00:00:00.000Z",
    );
    expect(summary.nextService?.status).toBe("upcoming");
    // earliest upcoming WARRANTY is #2 on 1 Mar
    expect(summary.nextWarranty?.number).toBe(2);
    expect(summary.nextWarranty?.dueDate.toISOString()).toBe(
      "2026-03-01T00:00:00.000Z",
    );
    expect(summary.warrantyVoidRisk).toBe(false);
  });

  it("flags void risk when an upcoming warranty service is already overdue", () => {
    const summary = summarizeWarranty(
      [
        {
          serviceKind: "warranty",
          status: "upcoming",
          warrantyNumber: 3,
          dueDate: new Date("2026-02-01T00:00:00.000Z"),
        },
      ],
      now,
    );

    expect(summary.warrantyVoidRisk).toBe(true);
    expect(summary.nextWarranty?.status).toBe("overdue");
  });

  it("omits next-date fields and counts zero for a bike with no services", () => {
    const summary = summarizeWarranty([], now);
    expect(summary.warrantyCompleted).toBe(0);
    expect(summary.warrantyLogged).toBe(0);
    expect(summary.warrantyVoidRisk).toBe(false);
    expect(summary.nextService).toBeUndefined();
    expect(summary.nextWarranty).toBeUndefined();
  });
});
