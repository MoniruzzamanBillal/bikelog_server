# Spending Summary

## Goal

Implement the single `spending` endpoint: a derived aggregation over `FuelLog.totalCost` and `MaintenanceLog.cost` for a bike, via the JS `filter()`/`reduce()` convention (never `$group`). This module has no model — everything is computed on read from the other two modules' collections.

## Design

**Ownership:** `findOwnedBikeOrThrow` (spec 03) first, same as every other nested resource.

**Resolving the "which window" gap:** the current `TSpendingSummary` interface only has `period: "month" | "year"`, with no way to say _which_ month/year — a gap already surfaced earlier in this project's planning. This spec resolves it by mirroring spec 05's mileage-stats query params exactly: `?period=month&targetMonth=YYYY-MM`, `?period=year&targetYear=YYYY`, or `?period=lifetime` (no target param needed) for an all-time total. Same inline query validation approach as spec 05 (not via the `validateRequest` zod middleware, which only covers `req.body`).

**`getSpendingSummaryFromDB(bikeId, period, targetMonth?, targetYear?)`:**

1. Resolve the date range the same way spec 05 does for the matching period (reuses the same date-range construction — consider extracting a small shared `resolveDateRange(period, targetMonth, targetYear)` util rather than duplicating it a second time).
2. Fetch `FuelLogModel.find({ bike: bikeId, date: { $gte, $lte } })` and `MaintenanceLogModel.find({ bike: bikeId, serviceDate: { $gte, $lte } }).populate("maintenanceType", "name")` in parallel.
3. `fuelTotal = fuelLogs.reduce((sum, f) => sum + f.totalCost, 0)` → one category-breakdown entry: `{ category: "Fuel", total: fuelTotal }`.
4. Group `maintenanceLogs` by `maintenanceType.name` via `reduce()` into a `Record<string, number>`, then convert to `{ category, total }` entries — one per distinct maintenance type actually logged in the window (types with zero logs in the period don't appear, rather than padding with zeros).
5. `totalSpending = fuelTotal + sum(all maintenance category totals)`.
6. Response: `{ period, targetMonth?, targetYear?, totalSpending, categoryBreakdown: [{category, total}, ...] }` — `categoryBreakdown` sorted descending by `total` (biggest spend category first, most useful default ordering for a summary view).

**Both event-date fields respected:** `FuelLog.date` and `MaintenanceLog.serviceDate` — never `createdAt` — same rationale as every other aggregation in this codebase (back-logged entries must land in the right period).

## Implementation

1. `spending.service.ts`: implement `getSpendingSummaryFromDB` per the Design section above. If spec 05's date-range helper was extracted to a shared location (e.g. `src/app/util/dateRange.ts`), reuse it here instead of reimplementing.
2. `spending.controller.ts`: wire the real handler, pulling `period`/`targetMonth`/`targetYear` from `req.query` with the same inline validation pattern as spec 05.
3. `spending.interface.ts`: extend `TSpendingSummary` with the optional `targetMonth`/`targetYear` fields.

## Dependencies

Spec 04 (`FuelLog.totalCost` must be reliably server-computed by then) and spec 08 (`MaintenanceLog.cost`/`maintenanceType` populate must exist and be correct). Also benefits from spec 05's date-range logic existing first, to reuse rather than duplicate.

## Verify-when-done

- [ ] `yarn build` / `yarn lint` clean.
- [ ] `totalSpending` always equals the sum of every entry in `categoryBreakdown` (no drift between the two).
- [ ] A back-logged fuel/maintenance entry lands in the correct historical month's summary, not the month it was entered.
- [ ] `period=lifetime` requires no `targetMonth`/`targetYear` and covers the bike's entire history correctly.
- [ ] Malformed `targetMonth`/`targetYear` returns 400, not a 500.
- [ ] Spending for bike A never leaks into bike B's summary for the same user.
