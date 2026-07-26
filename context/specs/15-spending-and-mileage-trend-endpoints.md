# Spending & Mileage Trend Endpoints

## Goal

Add one new endpoint to each of the `spending` and `mileageRecord` modules that returns the last N months of data as an array, so a client can render a trend chart. Both v1 endpoints only ever return a single period's totals (`spending`) or a fixed calendar-year's worth (`mileage`'s `/yearly`) — neither gives a rolling multi-month window in one call. This is v2 scope (`../../../v2-proposed-features/01-charts-trends.md`), backend-only for now; `bikelog_client-web-` consumes it in its own spec, mobile is a later, separate pass.

## Design

**Both new endpoints share one shape and one convention**: `GET .../trend?months=N` (N optional, default `3`, validated `1–24` inline in the controller — same pattern as this module's existing month/year validation, not the zod `validateRequest` middleware, since it's a query param not a body). Response: `{ months, monthlySummary: [...] }`, rolling backward from the current month (not calendar-year-bound) — i.e. `months=3` called in July returns May, June, July, regardless of year boundaries.

**Spending (`spending.service.ts`)**: the existing `getSpendingSummaryFromDB` inlines its fuel-log/maintenance-log find-and-reduce logic after resolving `startDate`/`endDate`. Extract that block into a new helper:

```ts
const computeSpendingForRange = async (
  bikeId: string,
  startDate?: Date,
  endDate?: Date,
): Promise<{ totalSpending: number; categoryBreakdown: { category: string; total: number }[] }>
```

— exact same body currently inline (the `fuelLogsPromise`/`maintenanceLogsPromise` `Promise.all`, the `fuelTotal`/`maintenanceByCategory`/`categoryBreakdown` construction, through `totalSpending`), just parameterized and returned instead of assembled into the final response object directly. `getSpendingSummaryFromDB` keeps its own date-range resolution (the `period === "month"`/`"year"` branches are unchanged) and calls this helper instead of inlining the query/reduce logic — this is a pure refactor, output for the existing endpoint must not change.

This mirrors the module's own established pattern: `mileageRecord.service.ts` already has an identical range-in, summary-out helper (`computeMileageForRange`), called once directly and once in a loop from `getYearlyMileageFromDB`. `computeSpendingForRange` should do the same job for spending.

New function, looping the helper over the last N months:

```ts
const getSpendingTrendFromDB = async (bikeId: string, userId: string, months: number) => {
  await findOwnedBikeOrThrow(bikeId, userId); // ownership check inside the service, matching this module's existing convention (unlike mileageRecord, which checks in the controller)
  const now = new Date();
  const monthlySummary = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const targetMonth = `${year}-${String(month).padStart(2, "0")}`;
    const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);
    const { totalSpending, categoryBreakdown } = await computeSpendingForRange(bikeId, startDate, endDate);
    monthlySummary.push({ targetMonth, totalSpending, categoryBreakdown });
  }
  return { months, monthlySummary };
};
```

**Mileage (`mileageRecord.service.ts`)**: no refactor needed — `computeMileageForRange(bikeId, startDate, endDate)` and the `MonthlyMileageResult` interface already exist and are reused as-is. New function, same rolling-window loop as spending but calling the existing mileage helper:

```ts
interface TrendMileageResult {
  months: number;
  monthlySummary: MonthlyMileageResult[];
}

const getMileageTrendFromDB = async (bikeId: string, months: number): Promise<TrendMileageResult> => {
  const now = new Date();
  const monthlySummary: MonthlyMileageResult[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const targetMonth = `${year}-${String(month).padStart(2, "0")}`;
    const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);
    const summary = await computeMileageForRange(bikeId, startDate, endDate);
    monthlySummary.push({ targetMonth, ...summary });
  }
  return { months, monthlySummary };
};
```

Ownership check for mileage stays in the controller (`findOwnedBikeOrThrow` before calling the service), matching `getYearlyMileage`'s existing shape exactly — do not move it into the service; the two modules are intentionally left with their pre-existing, different conventions here rather than unifying them as part of this change.

## Implementation

1. `spending/spending.service.ts` — extract `computeSpendingForRange`, refactor `getSpendingSummaryFromDB` to call it, add `getSpendingTrendFromDB`. Export both new/changed pieces from `spendingServices`.
2. `spending/spending.controller.ts` — add `getSpendingTrend`: parse `months` from `req.query` (default `3`, `AppError(400, ...)` if not `1–24`), call `spendingServices.getSpendingTrendFromDB(req.params.bikeId, req.user.userId, months)`, `sendResponse`.
3. `spending/spending.route.ts` — `router.get("/trend", authCheck, spendingController.getSpendingTrend);`. Final path: `GET /bikes/:bikeId/spending-summary/trend?months=3`.
4. `mileageRecord/mileageRecord.service.ts` — add `TrendMileageResult` interface and `getMileageTrendFromDB`. Export from `mileageRecordServices`.
5. `mileageRecord/mileageRecord.controller.ts` — add `getMileageTrend`: `findOwnedBikeOrThrow` first, then parse/validate `months` identically to spending's controller, call the service, `sendResponse`.
6. `mileageRecord/mileageRecord.route.ts` — `router.get("/trend", authCheck, mileageRecordController.getMileageTrend);`. Final path: `GET /bikes/:bikeId/mileage/trend?months=3`.
7. No `router/index.ts` change — both new routes are sub-paths of the already-mounted `spendingRouter`/`mileageRecordRouter`.
8. Add both new requests to `postman/bikelog-api.postman_collection.json` alongside the existing spending/mileage requests.

## Dependencies

None new — both modules and their existing helpers (`computeMileageForRange`, `findOwnedBikeOrThrow`) already exist and are unchanged in shape, only the spending module gets internally refactored.

## Verify-when-done

- [ ] `yarn build` / `yarn lint` clean.
- [ ] `GET /bikes/:bikeId/spending-summary` (the existing endpoint) still returns byte-identical shape/values after the `computeSpendingForRange` extraction — no regression from the refactor.
- [ ] `GET /bikes/:bikeId/spending-summary/trend?months=3` returns 3 months ending at the current month, rolling correctly across a year boundary (e.g. called in January returns Nov/Dec/Jan across two different years).
- [ ] `GET /bikes/:bikeId/mileage/trend?months=3` same rolling-window correctness check.
- [ ] Both endpoints default to `months=3` when the query param is omitted, and 400 (not 500) on an out-of-range or non-numeric `months` value.
- [ ] Trend data for bike A never leaks into bike B's response for the same user (ownership check exercised on both new endpoints).
- [ ] A bike with zero logs in a given month returns a zero-valued entry for that month (not a missing entry) — `monthlySummary` always has exactly `months` entries.
