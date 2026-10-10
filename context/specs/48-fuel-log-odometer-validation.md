# 48: Fuel-log odometer validation (server)

Status: ✅ Complete — implemented and verified 2026-10-10 (optional step 5 skipped; step 6 is an operator step on production — see checklist).

Fixes **DEF-04 (High)** from `TESTING_REPORT.md` (SQA cases TC-FUEL-015, TC-FUEL-016, TC-FUEL-018). Follow-up to specs 04 (fuel log + mileage closure), 26 (backdated logs) and 45 (manual odometer hardening, which explicitly left the fuel-log schema unchanged and pointed here).

**Scope: `bikelog-server` only.** No client change is required — the clients just surface the new 400 messages through their existing error handling.

---

## Problem

`POST /api/bikes/:bikeId/fuel-logs` and `PATCH /api/bikes/:bikeId/fuel-logs/:id` accept any `odometerReading`. Confirmed in the SQA run:

| Input                                                 | Today                                                                                                                | Should be |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------- |
| `odometerReading: -5`                                 | 201, stored                                                                                                          | 400       |
| `odometerReading: 1e999` / `Infinity`                 | 201, stored (Postgres `double precision` keeps `Infinity`, JSON then shows `null`) — same class as DEF-15 in spec 45 | 400       |
| `odometerReading: 500` when earlier logs are at 1350  | 201, stored                                                                                                          | 400       |
| full-tank fill at 1250 after a full-tank fill at 1300 | 201, stored, **`MileageRecord.distanceKm = -50`**, negative km/l                                                     | 400       |
| same checks via `PATCH`                               | not checked at all                                                                                                   | 400       |

Why it matters: `distanceKm`/`mileageKmPerLiter` feed the mileage stats endpoints (spec 05), the anomaly flag (spec 39), the AI insights prompt (spec 16) and the client charts. A negative record is **permanent** — closed records lock their fuel logs (409 on edit/delete), so the user cannot repair it through the API.

### Root cause

1. `fuelLog.validation.ts` — `odometerReading: z.number()` has no lower bound, no `.finite()`, no upper bound.
2. `fuelLog.service.ts › createFuelLogIntoDB` — never compares the new reading to existing logs, then computes `distanceKm = fuelLog.odometerReading - periodStartOdometer` and writes it unchecked. It also creates the `FuelLog` row **before** the closure math, so any later failure would leave an orphan log.
3. `fuelLog.service.ts › updateFuelLogInDB` — never inspects `odometerReading` or `date` at all.

---

## Design decisions

### A. What "lower than the current odometer" means here

Backdated fuel logs are a supported flow (spec 26 — users enter history after creating a bike, possibly in any order). So a reading must **not** be compared to `bike.currentOdometer` alone, or every backdated entry would be refused.

Instead the odometer must be **non-decreasing in date order across the bike's non-deleted fuel logs**. For a log with reading `R` and date `D`:

- **Lower bound** = `max( bike.initialOdometer, max(reading of other logs with date <= D) )` → require `R >= lowerBound`
- **Upper bound** = `min(reading of other logs with date > D)` (if any) → require `R <= upperBound`

Equal readings are allowed (two non-full top-ups at the same km are legitimate). Same-timestamp ties count as "before" (`<=`), so entry order breaks the tie. Soft-deleted logs (`isDeleted: true`) are ignored.

For the normal case — newest log, entered in order — this is exactly "must not be lower than the current odometer", which is what TC-FUEL-016 expects.

### B. Deliberately NOT comparing against `bike.currentOdometer`

`currentOdometer` can be raised by sources that are not fuel logs (manual update, spec 44; maintenance logs, spec 08) and is **never lowered** (DEF-12: deleting the top log does not roll it back; spec 44/45: the API refuses lower manual values). If fuel logs were forced to be `>= currentOdometer`, one typo (`15000` instead of `1500`, then deleted) would block that bike's fuel logging forever with no API recovery. The fuel-log chain is self-consistent and recoverable, so it is the source of truth for this validation.

Known gap (accepted, documented under "Not changing"): a fuel reading below a _maintenance/manual-only_ odometer jump is still accepted.

### C. Full-tank closure

After rule A, `R >= previous full-tank reading` is guaranteed, so a negative `distanceKm` can only come from a bug. Still:

- `distanceKm < 0` → defensive `400` (never reachable if A is correct; protects against future regressions).
- `distanceKm === 0` (e.g. the very first full-tank fill made exactly at the bike's `initialOdometer`, or two full fills at the same km) → **create the fuel log but do not create a `MileageRecord`** (`mileageRecordClosed: null`). A 0 km period has no meaningful km/l, and refusing it would block the natural "first fill at purchase" flow. The fill still acts as the baseline for the next period (the next closure anchors on it via `previousFullTank`).

### D. Order of operations in create

Validation and the closure pre-computation move **before** `prisma.fuelLog.create`, so a rejected request never leaves an orphan row and never bumps the bike odometer. Create → bump → closure-record write order afterwards is unchanged.

### E. Bounds

`.finite().nonnegative().max(999999)` — same cap spec 45 uses for the manual endpoint and the clients already enforce when creating a bike (`bike.schema.ts`), so no legitimate input is newly refused.

---

## Implementation

### Progress checklist

- [x] 1. `fuelLog.validation.ts` — bounded `odometerReading` in create + update schemas
- [x] 2. `fuelLog.service.ts` — new `assertOdometerInSequence` helper
- [x] 3. `fuelLog.service.ts › createFuelLogIntoDB` — call the helper; pre-compute closure; skip record on 0 km; guard negative
- [x] 4. `fuelLog.service.ts › updateFuelLogInDB` — call the helper when `odometerReading`/`date` change; bump bike odometer if raised
- [ ] 5. (Optional) DB `CHECK` constraint migration — **skipped on purpose**: optional, and it must ship after cleanup (step 6); the service/validation fix alone closes DEF-04
- [ ] 6. One-off cleanup of existing bad rows — **operator step, not run**: needs production access; use the two `SELECT`s in §6 and review before touching anything
- [x] 7. `yarn build` + `yarn lint`, rebuild `dist/`
- [x] 8. Tests: SQA cases + new cases below
- [x] 9. Docs: progress tracker, `TESTING_REPORT.md` addendum, Postman collection description

### 1. `src/app/modules/fuelLog/fuelLog.validation.ts`

Shared field, used by both schemas:

```ts
const odometerReadingField = z
  .number({
    required_error: "Odometer reading is required",
    invalid_type_error: "Odometer reading must be a number",
  })
  .finite("Odometer reading must be a finite number")
  .nonnegative("Odometer reading can't be negative")
  .max(999999, "Odometer reading can't exceed 999,999 km");

// createFuelLogSchema.body
odometerReading: odometerReadingField,

// updateFuelLogSchema.body
odometerReading: odometerReadingField.optional(),
```

Zod error shape already flows through `validateRequest` → 400 with the field message. Nothing else in the schemas changes (see "Not changing").

### 2. `src/app/modules/fuelLog/fuelLog.service.ts` — helper

Add above `createFuelLogIntoDB`:

```ts
// ! the odometer must be non-decreasing in DATE order across the bike's live fuel logs — NOT
// ! compared to bike.currentOdometer, which manual updates / maintenance logs can raise and
// ! nothing can lower (DEF-12), and which would also refuse legitimate backdated entries (spec 26)
const assertOdometerInSequence = async (
  bike: { id: string; initialOdometer: number },
  entry: { reading: number; date: Date; excludeId?: string },
) => {
  const base = {
    bikeId: bike.id,
    isDeleted: false,
    ...(entry.excludeId ? { id: { not: entry.excludeId } } : {}),
  };

  const [earlier, later] = await Promise.all([
    prisma.fuelLog.aggregate({
      where: { ...base, date: { lte: entry.date } },
      _max: { odometerReading: true },
    }),
    prisma.fuelLog.aggregate({
      where: { ...base, date: { gt: entry.date } },
      _min: { odometerReading: true },
    }),
  ]);

  const lowerBound = Math.max(
    bike.initialOdometer,
    earlier._max.odometerReading ?? bike.initialOdometer,
  );

  if (entry.reading < lowerBound) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Odometer reading (${entry.reading} km) can't be lower than the previous reading (${lowerBound} km)`,
    );
  }

  const upperBound = later._min.odometerReading;
  if (upperBound !== null && entry.reading > upperBound) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Odometer reading (${entry.reading} km) can't be higher than a later fuel log's reading (${upperBound} km)`,
    );
  }
};
```

Two `aggregate` calls on the existing `@@index([bikeId])` — one small query pair per write; no schema change.

### 3. `createFuelLogIntoDB`

Order after the existing purchase-date check:

1. `await assertOdometerInSequence(bike, { reading: payload.odometerReading as number, date })`
2. If `payload.isFullTank`: look up `previousFullTank` (same query as today, **before** create) → derive `periodStartOdometer` / `periodStartDate` exactly as today. Compute `distanceKm = payload.odometerReading - periodStartOdometer`.
   - `distanceKm < 0` → `throw new AppError(400, "Odometer reading is lower than the previous full-tank fill")` (defensive; unreachable after step 1).
   - `distanceKm === 0` → remember `skipRecord = true`.
3. `prisma.fuelLog.create(...)` and `bumpOdometerIfHigher(...)` — unchanged.
4. If `isFullTank && !skipRecord`: `periodFuelLogs` query, `litersConsumed`, `mileageKmPerLiter`, `prisma.mileageRecord.create(...)` — unchanged, reusing the pre-computed `periodStartOdometer`, `periodStartDate`, `distanceKm`.
5. Response shape unchanged: `mileageRecordClosed` is `null` for non-full-tank **and** for a 0 km full-tank fill. Both clients already treat it as nullable (spec 33 decision A) — verify in step 8 that the "mileage closed" toast/UI path is only taken when it is non-null.

Keep the existing `// !` comments about `initialOdometer` and `periodStartDate: null` (spec 26) intact when moving the code.

### 4. `updateFuelLogInDB`

After the existing locked-record (409) check and before building `updateData`:

```ts
if (payload.odometerReading !== undefined || payload.date !== undefined) {
  const existing = await prisma.fuelLog.findFirst({
    where: { id, bikeId, isDeleted: false },
  });
  if (!existing) throw new AppError(httpStatus.NOT_FOUND, "Fuel log not found");

  await assertOdometerInSequence(bike, {
    reading: payload.odometerReading ?? existing.odometerReading,
    date: payload.date ?? existing.date,
    excludeId: id,
  });
}
```

- `excludeId` makes a log not conflict with itself, so correcting a typo (`1500` → `1050`) on the newest log works.
- After a successful update with a changed `odometerReading`, call `await bumpOdometerIfHigher(bike, updated.odometerReading)` so a raised reading keeps `bike.currentOdometer` in step (create already does this; update never did). It is a no-op when the reading was lowered (no rollback — DEF-12 stays out of scope).
- The existing code fetches `existing`/`fuelLog` rows more than once; fold the new lookup into the existing `fuelLog` fetch rather than adding a third query while touching this function.
- `isFullTank` flips are not recomputed on update (unchanged behaviour; a log that closes a record is locked anyway).

### 5. (Optional, defence in depth) DB constraint

New migration (do not hand-edit prior ones), `prisma/migrations/<ts>_mileage_record_distance_check/migration.sql`:

```sql
-- NOT VALID: enforce for all new/updated rows without failing on legacy bad rows;
-- VALIDATE after the step-6 cleanup.
ALTER TABLE "mileage_records"
  ADD CONSTRAINT "mileage_records_distance_nonneg" CHECK ("distanceKm" >= 0) NOT VALID;

ALTER TABLE "fuel_logs"
  ADD CONSTRAINT "fuel_logs_odometer_nonneg" CHECK ("odometerReading" >= 0 AND "odometerReading" < 'Infinity'::float8) NOT VALID;
```

Prisma cannot model `CHECK` constraints, so keep them in raw SQL only; `prisma migrate dev` will not flag drift for them. Ship **after** the service fix — with only the constraint, bad input becomes a 500 instead of a 400 (the global handler does not map Prisma check violations). Skippable; the service/validation fix alone closes DEF-04.

### 6. Existing-data cleanup

Run once on any DB that ran the old build (dev first, then prod after a backup). Inspect before deleting:

```sql
SELECT id, "bikeId", "startOdometer", "endOdometer", "distanceKm" FROM mileage_records WHERE "distanceKm" < 0;
SELECT id, "bikeId", "odometerReading", date FROM fuel_logs WHERE "odometerReading" < 0 OR "odometerReading" = 'Infinity'::float8;
```

Negative-distance records are unrecoverable through the API (locked fuel logs), so fix by hand: delete the bad `mileage_records` row, then soft-delete (`isDeleted = true`) or correct the offending `fuel_logs` row. Then `ALTER TABLE ... VALIDATE CONSTRAINT ...` if step 5 was applied. If bikes had `currentOdometer` bumped by a bad reading, correct it in the same session.

---

## Test plan

Add a `TC-FUEL-0xx` block (extend `sqa-evidence/sqa.test.js` or a new `fuelodometer.test.js` alongside `odometer.test.js`). Each case uses a fresh bike with `initialOdometer = 1000`.

| Case                             | Request                                                         | Expected                                                                                       |
| -------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| negative                         | `POST` reading `-5`                                             | 400, message mentions "negative"; no row created                                               |
| infinite / huge                  | raw body `1e999`; `1000000`                                     | 400 each                                                                                       |
| non-number                       | `"abc"`                                                         | 400 (existing)                                                                                 |
| below initial                    | first log reading `900`                                         | 400                                                                                            |
| at initial                       | first log reading `1000`, non-full                              | 201                                                                                            |
| in order                         | `1000` → `1100` → `1100` (equal)                                | 201 ×3                                                                                         |
| lower than previous              | after `1100`, post `1050` (later date)                          | 400; bike `currentOdometer` unchanged                                                          |
| backdated, valid                 | logs `1100` (Feb 10), `1300` (Feb 20); post `1200` dated Feb 15 | 201                                                                                            |
| backdated, below lower bound     | post `1050` dated Feb 15 (previous is `1100`)                   | 400                                                                                            |
| backdated, above upper bound     | post `1400` dated Feb 15 (later is `1300`)                      | 400                                                                                            |
| reverse-order history entry      | enter newest first (`1300`, Feb 20) then older (`1100`, Feb 10) | 201 both                                                                                       |
| soft-deleted ignored             | delete the `1300` log, then post `1250`                         | 201                                                                                            |
| full-tank negative (TC-FUEL-018) | full `1300`, then full `1250` later                             | 400; **no** `mileage_records` row with `distanceKm < 0`                                        |
| full-tank zero                   | first-ever full fill at `1000` (= initial)                      | 201, `mileageRecordClosed === null`; next full at `1100` closes a 100 km record anchored on it |
| full-tank happy path             | full `1100`, full `1400`                                        | 201, record `distanceKm = 300` (regression for spec 04/26)                                     |
| rejected create leaves nothing   | any 400 above                                                   | no `fuel_logs` row, bike odometer unchanged                                                    |
| PATCH lower than previous        | patch a middle log to below its predecessor                     | 400                                                                                            |
| PATCH above next                 | patch a middle log above its successor                          | 400                                                                                            |
| PATCH typo fix on newest         | `1500` → `1050` (valid vs predecessor)                          | 200                                                                                            |
| PATCH raise                      | raise newest log; `GET /bikes/:id`                              | 200; `currentOdometer` follows                                                                 |
| PATCH self-tie                   | patch `date` only, reading unchanged                            | 200 (self excluded)                                                                            |
| PATCH locked log                 | patch a log inside a closed record                              | 409 (unchanged)                                                                                |

Pass criteria: all new cases pass; `sqa.test.js` shows TC-FUEL-015/016/018 flipped to PASS with **no new failures** versus the 2026-10-03 baseline (247 pass / 25 fail / 2 skip); `odometer.test.js` 40/40; `race.js` still 0 wrong trials; `behaviour.test.js` 15/15.

> Check the SQA fixtures: TC-FUEL-016 expects 500 to be rejected "when current odometer is 1350". It passes only if that 1350 comes from fuel logs dated before the test's `date`. If the fixture raised the odometer another way, adjust the fixture, not the rule (see decision B).

Client smoke test (no code change expected): in both clients, submit a lower reading and confirm the 400 message renders in the existing error toast.

---

## Explicitly NOT changing

- **Maintenance/manual-only odometer jumps** are not part of the fuel-log chain, so a fuel reading below them is still accepted (decision B). Follow-up option: include `MaintenanceLog.odometerReading` by date in the bounds — needs its own spec, as it has the same backdating questions.
- **DEF-12** (deleting the top log doesn't roll `currentOdometer` back) and **DEF-01-style races between two concurrent fuel-log creates**: validation reads then writes, so two simultaneous requests could both pass. Closing that needs a serializable transaction or an advisory lock per bike; out of scope here.
- Other numeric fields (`litersAdded`, `pricePerLiter`) still lack `.finite()`/upper bounds. Same class, separate low-risk follow-up (DEF-13-ish).
- Backdating a _full-tank_ fill into a period that is already closed (its `periodFuelLogs` overlap a locked record) — pre-existing, unrelated to sign/ordering.
- Client forms and schemas: no change.
- `dist/` is stale in production (`TESTING_REPORT.md` §8) — this fix reaches users only after a rebuild and redeploy.

## Rollout

1. Implement steps 1–4, `yarn build && yarn lint` (expect 0 errors, the 16 known warnings).
2. Run the test plan against a local DB.
3. Back up prod, run step-6 queries, clean legacy rows.
4. Deploy rebuilt `dist/`; then (optional) apply step-5 migration.
5. Update `context/progress-tracker.md`, add the addendum to `TESTING_REPORT.md` (DEF-04 → fixed, reference this spec), and flip this spec's status to ✅ Complete.

---

## Results (2026-10-10)

Run on a throwaway local Postgres (the real Neon DB was not touched), server started from the rebuilt `dist/`, compared against the pre-change `dist/` from `HEAD`.

| Run | Before (old `dist/`) | After |
| --- | --- | --- |
| New `sqa-evidence/fuelodometer.test.js` (27 cases: validation, ordering, backdating, soft-delete, full-tank, 0 km, PATCH) | 14 / 27 (13 real failures) | **27 / 27** |
| `sqa.test.js` (274 cases) | 248 pass / 24 fail / 2 skip | 251 / 21 / 2 — **only TC-FUEL-015, 016, 018 changed (FAIL → PASS)**, no other status moved |
| `odometer.test.js` (spec 44/45) | 40 / 40 | 40 / 40 |
| `race.js` (DEF-01 probe) | — | 0/8 and 0/8 wrong trials |
| `behaviour.test.js` | — | 15 / 15 |
| `yarn build` / `yarn lint` | clean / 0 errors, 23 warnings | clean / 0 errors, 23 warnings (no new) |

Notes:

- The baseline here is 248/24/2, not the documented 247/25/2: the one-case difference is TC-FUEL-026 (the DEF-01 race probe), which is flaky by nature.
- Decision confirmed by TC-FUEL-016: the 1350 km "current odometer" in that fixture comes from fuel logs, so the date-ordered rule rejects the 500 km reading.
- Client smoke test (surfacing the new 400 messages in both clients' error toast) was **not** run — it needs the apps; no client code changed.
