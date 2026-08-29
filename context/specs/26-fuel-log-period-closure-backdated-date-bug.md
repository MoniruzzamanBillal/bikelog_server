# 26: Fix Mileage-Period Closure for Backdated Fuel Logs (Data Corruption + Integrity Bypass)

Status: 📋 Proposed — not started

## Goal

Found during a full-system test pass (2026-08-29): creating a bike, then logging **backdated** fuel history (fuel logs dated before the bike's own `createdAt`) and closing a full-tank period produces a silently wrong, zeroed-out `MileageRecord` — and, worse, lets a fuel log that's actually part of a closed period be freely edited or deleted, bypassing the referential-integrity guard that's supposed to prevent exactly that. Fix the root cause in `createFuelLogIntoDB`'s period-closure logic.

## Context

**Confirmed repro** (live-tested against a real local server, real dev DB, throwaway fixtures — cleaned up afterward):

1. `POST /bikes` → bike created now (`createdAt` ≈ `2026-08-29T10:50:34Z`, `initialOdometer: 1500`).
2. `POST .../fuel-logs`, `date: "2026-07-01"`, partial fill, 3L.
3. `POST .../fuel-logs`, `date: "2026-07-10"`, **full tank**, 5.5L, `odometerReading: 1650`.

**Actual `mileageRecordClosed`** from step 3's response:
```json
{
  "startOdometer": 1500,
  "endOdometer": 1650,
  "distanceKm": 150,
  "litersConsumed": 0,
  "mileageKmPerLiter": 0,
  "periodStartDate": "2026-08-29T10:50:34.156Z",
  "periodEndDate": "2026-07-10T00:00:00.000Z",
  "fuelLogIds": []
}
```
`litersConsumed`/`mileageKmPerLiter` should be `8.5` / `~17.6` (3 + 5.5 liters across the two logs), and `fuelLogIds` should contain both fuel logs' ids — instead both are zeroed and empty. Independently confirmed wrong: `GET .../mileage/monthly?targetMonth=2026-07` (a completely separate code path, `mileageRecord.service.ts`'s `computeMileageForRange`) correctly returns `totalLitersConsumed: 8.5` for the exact same underlying data — the two endpoints disagree about the same bike's history, and the closure-time one is the wrong one.

Also note `periodEndDate` (`2026-07-10`) ends up **chronologically before** `periodStartDate` (`2026-08-29`) in the stored record — a visible tell that something is structurally backwards, not just numerically off.

**Root cause** — `src/app/modules/fuelLog/fuelLog.service.ts`, `createFuelLogIntoDB` (~lines 44–67):

```ts
if (previousFullTank) {
  periodStartOdometer = previousFullTank.odometerReading;
  periodStartDate = previousFullTank.date;
} else {
  periodStartOdometer = bike.initialOdometer;
  periodStartDate = (bike as TBikeDocument).createdAt;   // ← the bug
}

const periodFuelLogs = await fuelLogModel.find({
  bike: bikeId,
  date: { $gt: periodStartDate, $lte: fuelLog.date },     // ← inverted/empty range when fuelLog.date < periodStartDate
  isDeleted: false,
}).sort({ date: 1 }).lean();
```

When a bike has no prior full-tank fill yet, `periodStartDate` falls back to `bike.createdAt` — the moment the *bike record* was created in the database, not anything about the fuel-log history itself. Backdating fuel logs is an explicitly supported, documented feature (`postman/dummy-data.md`: fuel log `date` "defaults to now; use for back-logging") and an extremely common real flow — a rider creates their bike profile today and immediately logs fuel history from the past weeks/months to get accurate mileage from day one. Whenever any fuel log in that backfill has a `date` earlier than the bike's own `createdAt` (true for essentially every backdated entry, since the bike itself didn't exist yet at that date), the query's `$gt: periodStartDate` lower bound sits *after* `$lte: fuelLog.date`'s upper bound — an inverted range that matches zero documents, however many real fuel logs actually exist in that window.

**Second-order bug — the referential-integrity guard silently fails as a consequence.** `updateFuelLogInDB`/`deleteFuelLogFromDB` (same file, ~lines 149/188) check `mileageRecordModel.exists({ fuelLogIds: id })` before allowing an edit/delete, specifically to protect a fuel log that's already "baked into" a closed mileage period. Because the buggy query above produces `fuelLogIds: []`, that check finds nothing — **confirmed live: `DELETE` on the exact fuel log that closed this broken period succeeded with `200`, not the expected `409`.** A fuel log that's supposed to be protected can be freely edited or deleted, corrupting historical mileage data further on top of the already-wrong initial record.

**Scope check — this is isolated to `fuelLog.service.ts`.** Grepped the whole `src/app/modules` tree for other uses of `bike.createdAt` as a query anchor — none found. `mileageRecord.service.ts`'s `computeMileageForRange` (backing the monthly/yearly/lifetime/trend endpoints) has a structurally similar "no earlier fuel log" fallback, but only for the **odometer** anchor (`bike.initialOdometer`), never a date anchor — its date range comes from the calling endpoint's own calendar month/year boundaries, not from `bike.createdAt`. That function is confirmed unaffected (its output for the repro above was independently correct, as noted above).

## Design

Replace the `bike.createdAt` date-anchor fallback with **no lower date bound at all** for the "no previous full-tank fill yet" case — every fuel log dated on or before this closing fill legitimately belongs to this first-ever period, regardless of when the bike record itself happened to be created:

```ts
let periodStartOdometer: number;
let periodStartDate: Date | null;

if (previousFullTank) {
  periodStartOdometer = previousFullTank.odometerReading;
  periodStartDate = previousFullTank.date;
} else {
  periodStartOdometer = bike.initialOdometer;
  periodStartDate = null; // ! no lower bound — this is the bike's first-ever closed period
}

const periodFuelLogs = await fuelLogModel
  .find({
    bike: bikeId,
    date: periodStartDate
      ? { $gt: periodStartDate, $lte: fuelLog.date }
      : { $lte: fuelLog.date },
    isDeleted: false,
  })
  .sort({ date: 1 })
  .lean();
```

The just-created `fuelLog` document itself is always included in `periodFuelLogs` (its own `date` trivially satisfies `$lte: fuelLog.date`), so `periodFuelLogs` can never come back empty — there's no new empty-array edge case to guard against that doesn't already exist today.

**Stored/displayed `periodStartDate`** — for the "no previous full tank" branch, derive the value actually written to the `MileageRecord` document from the *earliest fuel log actually included* in the period, rather than the arbitrary `bike.createdAt` timestamp — this makes the displayed period range ("Jul 1 – Jul 10") reflect real fuel-log history instead of an unrelated bike-creation moment:

```ts
const resolvedPeriodStartDate =
  periodStartDate ?? periodFuelLogs[0]?.date ?? (bike as TBikeDocument).createdAt;

mileageRecordClosed = await mileageRecordModel.create({
  bike: bikeId,
  startOdometer: periodStartOdometer,
  endOdometer: fuelLog.odometerReading,
  distanceKm,
  litersConsumed,
  mileageKmPerLiter,
  periodStartDate: resolvedPeriodStartDate,
  periodEndDate: fuelLog.date,
  fuelLogIds,
});
```

The `(bike as TBikeDocument).createdAt` fallback stays only as a defensive last resort (`periodFuelLogs[0]` can't actually be `undefined` given the just-created fuel log is always in the array, but keeping the fallback costs nothing and avoids a theoretical `Date` type issue).

**Not touched by this fix**: `updateFuelLogInDB`/`deleteFuelLogFromDB`'s guard logic itself is correct as written — it was only ever failing because the data it checks against was wrong. Fixing the root cause fixes the guard's behavior automatically, with no changes needed to those two functions.

**Data migration — flagged, not built.** Any `MileageRecord` already created by the buggy code path (in a dev/test database, before this fix ships) will still have the wrong stored `litersConsumed`/`mileageKmPerLiter`/`fuelLogIds`/`periodStartDate` — this fix only prevents the bug going forward, it doesn't repair existing bad records. No production data exists yet for this app (confirmed earlier this session — `master` has never been deployed past a very early commit), so a backfill/migration script is very likely unnecessary; flagging only in case any dev-database fixture already has this shape and needs a manual look.

## Implementation

1. ⏳ `src/app/modules/fuelLog/fuelLog.service.ts`, `createFuelLogIntoDB` — replace the `bike.createdAt` date anchor with the `periodStartDate: Date | null` sentinel approach above; derive the stored `periodStartDate` from the earliest included fuel log.
2. ⏳ `postman/dummy-data.md` — if this module's docs mention period-closure semantics for the "first ever full tank" case, verify/update to describe the corrected behavior (check at implementation time; may already be silent on this specific edge case).
3. ⏳ `context/progress-tracker.md` — mark this spec's row, per the established In Progress → Complete discipline.

## Dependencies

None new.

## Verify

- [ ] Repeat the exact repro above (bike created now, two backdated fuel logs from last month, second one a full-tank close) — confirm `mileageRecordClosed.litersConsumed`/`mileageKmPerLiter` are correct (non-zero, matching the sum of liters in the period) and `fuelLogIds` contains both fuel log ids.
- [ ] Confirm `periodStartDate` in the created record is now the earliest fuel log's own date, not the bike's `createdAt` timestamp — and that `periodStartDate <= periodEndDate` (no more chronologically-inverted records).
- [ ] Confirm the integrity guard now actually blocks: `DELETE`/`PATCH` on either fuel log that's part of this now-correctly-closed period returns `409`, not `200`.
- [ ] Regression: the **non-backdated** case (fuel logs dated normally, on or after bike creation) still closes correctly — this is the path that was already working, must not break.
- [ ] Regression: the **second-and-later** full-tank closure case (where `previousFullTank` exists) is untouched by this fix — confirm it still works exactly as before.
- [ ] `yarn build` clean; `yarn lint` — same pre-existing baseline, no new errors/warnings.
