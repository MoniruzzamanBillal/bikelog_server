# Mileage Stats (`mileageRecord`, read-only)

## Goal

Implement the four read-only mileage endpoints. This module never writes — `MileageRecord` documents are created as a side effect of `fuelLog`'s closure logic (spec 04). Everything here is querying/aggregating existing `FuelLog`/`MileageRecord` data via the JS `.find()` + `filter()`/`reduce()` convention (never Mongo `$group`), per `context/architecture.md`'s aggregation invariant.

## Design

**Ownership:** all four endpoints take `:bikeId`, call `findOwnedBikeOrThrow` (spec 03) first.

**`getMileageRecords(bikeId)`** → `GET /bikes/:bikeId/mileage`:
- Exact history: `MileageRecordModel.find({ bike: bikeId }).sort("-periodEndDate")`.
- Plus a live **approximate rolling-average** figure (plan §2.1 fallback), computed regardless of whether any closures have happened: take the trailing N `FuelLog`s for this bike (N configurable, default 10 — matches the plan's "last 10 fills" example), `distance = last.odometerReading - first.odometerReading`, `liters = sum(litersAdded across all N, including partials)`, `approxMileageKmPerLiter = distance / liters`.
- Response shape: `{ exactRecords: MileageRecord[], approximate: { mileageKmPerLiter, basedOnFuelLogCount, isEstimate: true } | null }` (`null` if fewer than 2 fuel logs exist yet — not enough data for even an estimate).

**`getMonthlyMileage(bikeId, targetMonth)`** → `GET /bikes/:bikeId/mileage/monthly?targetMonth=YYYY-MM`:
- Date range: `new Date(year, month-1, 1)` to `new Date(year, month, 0, 23,59,59,999)` — same construction as the sibling expense-tracker pattern this convention originates from.
- `FuelLogModel.find({ bike: bikeId, date: { $gte, $lte } })`, bucketed by `date` (never `createdAt` — back-logged entries must land in the month they actually happened, not the month they were entered).
- `totalDistanceKm = lastOdometerInMonth - firstOdometerBeforeOrInMonth` (needs the last fuel log *before* the month started, to get a starting odometer — not just logs strictly inside the range), `totalLitersConsumed = sum(litersAdded in range)`.
- Response: `{ targetMonth, totalDistanceKm, totalLitersConsumed, fuelLogCount }` — **no average field**; per the client-side-average convention, the frontend divides these two totals itself.

**`getYearlyMileage(bikeId, targetYear)`** → `GET /bikes/:bikeId/mileage/yearly?targetYear=YYYY`:
- Same per-month computation as above, looped over all 12 months of the target year.
- Response: `{ targetYear, monthlySummary: [{ month, totalDistanceKm, totalLitersConsumed, fuelLogCount }] }` (12 entries, zeros for months with no fuel logs).

**`getLifetimeMileage(bikeId)`** → `GET /bikes/:bikeId/mileage/lifetime`:
- All `FuelLog`s for the bike from its earliest entry to now.
- Response: `{ totalDistanceKm, totalLitersConsumed, fuelLogCount }` — `totalDistanceKm` = last odometer reading minus the bike's earliest known reading (either its first fuel log or `Bike.currentOdometer` at creation time, whichever is the true starting point).

**Query param validation:** `targetMonth`/`targetYear` are on `req.query`, and `validateRequest` (per the codebase-wide gotcha noted in spec 02's ground truth) only validates `req.body`. This spec does **not** propose extending that middleware — instead, validate `targetMonth`/`targetYear` inline in the controller/service (basic format/range check, `AppError(400, ...)` on garbage input) to keep the change contained to this module.

## Implementation

1. `mileageRecord.service.ts`: implement all 4 functions per the Design section, reusing a small internal helper for "sum liters / compute distance over a FuelLog date range" shared across monthly/yearly/lifetime (avoid triplicating the reduce logic).
2. `mileageRecord.controller.ts`: wire real handlers, pulling `targetMonth`/`targetYear` from `req.query` with inline validation.
3. No model/validation file changes — `mileageRecord.validation.ts` correctly stays the empty placeholder (no write endpoints here).

## Dependencies

Spec 04 (this module only has data to read once fuel logs and closures exist — logically sequenced after it, though the code itself has no import-time dependency on `fuelLog`).

## Verify-when-done

- [ ] `yarn build` / `yarn lint` clean.
- [ ] Monthly/yearly/lifetime totals bucket strictly by `FuelLog.date`, verified with a manually back-dated fuel log landing in the correct past month despite being created today.
- [ ] `getMileageRecords` returns `approximate: null` (not a divide-by-zero or NaN) when fewer than 2 fuel logs exist.
- [ ] None of the four endpoints return a computed "average" field themselves — only totals (client divides).
- [ ] Malformed `targetMonth`/`targetYear` query params return 400, not a 500 from a bad `Date` construction.
