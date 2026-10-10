# 50: Sanity validation — future purchase date, catalog names, maintenance dates (server)

Status: ✅ Complete — implemented and verified locally 2026-10-10.

Fixes **DEF-13 (Low)** from `TESTING_REPORT.md` (SQA cases TC-BIKE-009, TC-MT-004, TC-MT-007, TC-ML-009), plus one related hole found while verifying spec 49 (§E). Follow-up to specs 03 (bike), 06/07 (catalogs), 08 (maintenance log), 41 (catalog soft delete / revive-by-name), 46 (per-user catalogs) and 48 (the fuel-log purchase-date rule this mirrors).

**Scope: `bikelog-server` only.** No client change; the clients already render the server's 400/409 message.

---

## Problem

The report accepted four inputs that no real user means to send:

| #   | Input                                                                                        | Today                       | Should be                                                 |
| --- | -------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------- |
| 1   | `POST/PATCH /bikes` with `purchaseDate: 2099-01-01`                                          | 201/200, stored             | 400                                                       |
| 2   | `POST/PATCH /maintenance-types` with `name: ""`                                              | 201, an unnamed catalog row | 400                                                       |
| 3   | `POST /maintenance-types` with `name: "engine oil change"` when `"Engine Oil Change"` exists | 201, a visible duplicate    | 409                                                       |
| 4   | `POST/PATCH .../maintenance-logs` with `serviceDate: 2020-01-01` on a bike bought in 2024    | 201/200, stored             | 400 — fuel logs already refuse this, maintenance does not |

### Root cause

1. `bike.validation.ts` — `purchaseDate: z.coerce.date()` has no upper bound.
2. `maintenanceType.validation.ts` / `engineOilType.validation.ts` — `name: z.string()` accepts `""` and whitespace. (Zod's `.trim()` would also be applied to the parsed body: `validateRequest` writes `parsed.body` back onto `req.body`, so a `.trim()` in the schema reaches the service.)
3. The catalogs' uniqueness is the DB constraint `@@unique([ownerId, name])` — **case-sensitive**, and it covers soft-deleted rows (spec 41). The only duplicate check is the `P2002` catch.
4. `maintenanceLog.service.ts` has no equivalent of `fuelLog.service.ts`'s `date < bike.purchaseDate` check.

---

## Design decisions

### A. Future purchase date: allow up to one day ahead

`purchaseDate` arrives as `"YYYY-MM-DD"`, which `z.coerce.date()` reads as **midnight UTC**. A user in Dhaka (UTC+6) entering today's date shortly after local midnight sends a date that is still "tomorrow" in UTC. A strict `<= now` would wrongly reject their own today. So the rule is `purchaseDate <= now + 24 h`. 2099 is refused; tomorrow-in-UTC, which is today somewhere, is not. The bound is evaluated at **request time** (inside a Zod `.refine`, not at module load).

Applies to create **and** update. The update path is not changed beyond the refine: moving `purchaseDate` later than a bike's existing logs is a separate consistency question (see "Not changing").

### B. Catalog names: trim, non-empty, both catalogs

`name` becomes `z.string({ required_error: "Name is required" }).trim().min(1, "Name is required")` in both create schemas, and `.trim().min(1, …).optional()` in both update schemas. Whitespace-only is therefore also refused, and stored names are trimmed (`" Chain Lube "` → `"Chain Lube"`) — this also stops a trailing-space duplicate slipping past the case-insensitive check below. DEF-13 names only the maintenance catalog; `engineOilType` has the identical schema and the identical hole, and a rule that holds for one catalog but not its twin would be a trap, so both are fixed together.

### C. Case-insensitive duplicate names (per user)

Uniqueness is per owner (spec 46), so only the caller's own rows are compared; another user having `"engine oil"` is unaffected.

Create flow (both catalogs), replacing the current "exact name soft-deleted → revive, else insert":

1. **Live conflict:** a row with `ownerId = userId`, `isDeleted = false`, `name` equal ignoring case → `409` with the existing message ("A maintenance type with this name already exists" / "An engine oil type with this name already exists").
2. **Revive (spec 41/46 behaviour, widened to ignore case):** otherwise, a soft-deleted row of this owner whose name equals ignoring case → revive that row (keeps its id, so its historical logs stay labelled). Prefer an exactly-equal row if several match. If the matched row's stored casing differs from what the user typed, set `name` to the typed value — the user's latest spelling wins. This cannot collide on `(ownerId, name)`: an exactly-equal row would have been preferred, and a live ignoring-case match was already refused in step 1.
3. Otherwise insert, with the existing `P2002 → 409` catch kept as the backstop.

Update flow: when `name` is in the payload, a live ignoring-case match **excluding this row's own id** → `409`. Renaming `"engine oil"` to `"Engine Oil"` (same row, new casing) is therefore allowed. The existing `P2002` catch stays.

Implementation: one small helper per module in `<module>.utils.ts`, next to `findOwnedXOrThrow`, e.g. `findLiveNameConflict(userId, name, excludeId?)`. Not a shared cross-module abstraction — house style is per-module utils.

**Wildcard check — it failed, as feared.** Prisma's `mode: "insensitive"` on PostgreSQL compiles to `ILIKE`, so `_` and `%` in a user's name acted as wildcards: with `"ABC"` present, creating `"A_C"` returned a false `409`. Both lookups therefore use raw `lower(name) = lower($1)` via `$queryRaw` (see §3); the wildcard cases in the test plan guard it.

**No DB migration.** A functional unique index on `(ownerId, lower(name))` would be the airtight version, but production may already contain case-variant duplicates (legacy data), which would make the migration fail. See "Not changing" for the detection query.

### D. Maintenance log date vs. purchase date

Mirror `fuelLog.service.ts` exactly: `serviceDate < bike.purchaseDate` → `400` `Maintenance date cannot be before the bike's purchase date (YYYY-MM-DD)`; a date equal to the purchase date is allowed. On **create**, the effective date is `payload.serviceDate ?? new Date()` (the same default the insert uses), checked right after the bike lookup and before the catalog lookups. On **update**, only when `payload.serviceDate` is present. `updateMaintenanceLogInDB` already holds the bike row (`const bike = …`, since spec 49).

### E. Found during spec 49: maintenance odometer is unbounded

`POST /bikes/:id/maintenance-logs` with a raw `odometerReading: 1e999` returns 201 and wedges the bike's `currentOdometer` at `Infinity` (JSON shows `null`; nothing can lower it) — verified in spec 49's `odometerrace.test.js` probe. It is the same defect class as DEF-15 (spec 45) and DEF-04 (spec 48), and spec 49 §C makes the update path a second way to reach it. Same field definition as spec 48: `.finite().nonnegative().max(999999)`, in both maintenance-log schemas. Only `odometerReading` — `cost` and `intervalKmUsed` are out of scope.

---

## Implementation

### Progress checklist

- [x] 1. `bike.validation.ts` — future `purchaseDate` refused on create + update
- [x] 2. `maintenanceType.validation.ts` + `engineOilType.validation.ts` — trimmed, non-empty `name` (create + update)
- [x] 3. `maintenanceType.utils.ts` + `.service.ts` — case-insensitive conflict / revive on create, conflict on update
- [x] 4. `engineOilType.utils.ts` + `.service.ts` — same for the oil catalog
- [x] 5. `maintenanceLog.service.ts` — `serviceDate` before purchase date refused on create + update
- [x] 6. `maintenanceLog.validation.ts` — bounded `odometerReading` (create + update)
- [x] 7. `yarn build` + `yarn lint`, rebuild `dist/`
- [x] 8. Tests: new `sanity.test.js`, full regression
- [x] 9. Docs: Postman descriptions, `dummy-data.md`, `TESTING_REPORT.md`, progress tracker

### 1. `src/app/modules/bike/bike.validation.ts`

```ts
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// ! up to 24h ahead, not "<= now": "YYYY-MM-DD" parses as midnight UTC, so a user east of UTC
// ! entering today's date just after their local midnight is still "tomorrow" in UTC. 2099 is
// ! refused; this evaluates per request because refine runs at parse time (spec 50)
const notInTheFuture = (d: Date) => d.getTime() <= Date.now() + ONE_DAY_MS;

// createBikeSchema.body
purchaseDate: z.coerce
  .date({ required_error: "Purchase date is required" })
  .refine(notInTheFuture, "Purchase date can't be in the future"),

// updateBikeSchema.body
purchaseDate: z.coerce
  .date()
  .refine(notInTheFuture, "Purchase date can't be in the future")
  .optional(),
```

### 2. Catalog name validation

`maintenanceType.validation.ts` and `engineOilType.validation.ts`:

```ts
// create
name: z.string({ required_error: "Name is required" }).trim().min(1, "Name is required"),
// update
name: z.string().trim().min(1, "Name can't be empty").optional(),
```

### 3. `maintenanceType.utils.ts` / `.service.ts`

Helpers (in `maintenanceType.utils.ts`, mirrored in `engineOilType.utils.ts` against `engine_oil_types`):

```ts
// ! raw lower(), NOT Prisma's `mode: "insensitive"` — that is ILIKE on PostgreSQL, where `_` and
// ! `%` in a user's name act as wildcards ("A_C" would falsely collide with "ABC")
export const findLiveNameConflict = async (userId: string, name: string, excludeId?: string) => {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM maintenance_types
     WHERE "ownerId" = ${userId} AND "isDeleted" = false AND lower(name) = lower(${name})
       ${excludeId ? Prisma.sql`AND id <> ${excludeId}` : Prisma.empty}
     LIMIT 1`;
  return rows[0] ?? null;
};

// soft-deleted rows of this owner matching ignoring case; ids via raw SQL, rows via findMany
export const findSoftDeletedNameMatches = async (userId: string, name: string) => { /* … */ };
```

`createMaintenanceTypeIntoDB`:

1. `if (await findLiveNameConflict(userId, name)) throw new AppError(409, "A maintenance type with this name already exists")`.
2. Replace the exact-name soft-deleted lookup with `findSoftDeletedNameMatches(userId, name)` (ignoring case), pick the row whose `name === name` if any, else the first. Revive with the existing `data` plus `name` (so the casing follows what was typed). Keep the existing explanatory spec 41 / 46 comments, extended with one `// !` line about spec 50.
3. Insert path and `P2002` catch unchanged.

`updateMaintenanceTypeInDB`: after `findOwnedMaintenanceTypeOrThrow`, `if (payload.name !== undefined && (await findLiveNameConflict(userId, payload.name, id))) throw 409`. `P2002` catch unchanged.

### 4. `engineOilType.utils.ts` / `.service.ts`

Identical shape against `prisma.engineOilType`; 409 message "An engine oil type with this name already exists"; revive `data` keeps `isDeleted: false` and `suggestedIntervalKm`.

### 5. `src/app/modules/maintenanceLog/maintenanceLog.service.ts`

```ts
// ! mirrors fuelLog.service.ts: a service can't predate owning the bike (spec 50)
const assertNotBeforePurchase = (serviceDate: Date, purchaseDate: Date) => {
  if (serviceDate < purchaseDate) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Maintenance date cannot be before the bike's purchase date (${purchaseDate.toISOString().split("T")[0]})`,
    );
  }
};
```

Create: right after `findOwnedBikeOrThrow`, `assertNotBeforePurchase(payload.serviceDate ?? new Date(), bike.purchaseDate)`. Update: `if (payload.serviceDate) assertNotBeforePurchase(payload.serviceDate, bike.purchaseDate)`, placed with the other pre-write checks. A function-local helper is enough (one module uses it); do not extract to `bike.utils.ts` unless a second caller appears.

### 6. `src/app/modules/maintenanceLog/maintenanceLog.validation.ts`

Same field as spec 48's, local to this file:

```ts
const odometerReadingField = z
  .number({
    required_error: "Odometer reading is required",
    invalid_type_error: "Odometer reading must be a number",
  })
  .finite("Odometer reading must be a finite number")
  .nonnegative("Odometer reading can't be negative")
  .max(999999, "Odometer reading can't exceed 999,999 km");
```

Create: `odometerReading: odometerReadingField`; update: `odometerReadingField.optional()`.

---

## Test plan

New `sqa-evidence/sanity.test.js` (same harness style as `fuelodometer.test.js`; local server `:5055` + throwaway Postgres). Each case uses fresh data / unique names.

| Area                     | Case                                                                 | Expected                                                               |
| ------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Bike                     | create `purchaseDate: 2099-01-01`                                    | 400, message mentions "future"                                         |
| Bike                     | `PATCH` a bike to 2099                                               | 400                                                                    |
| Bike                     | create with today / with tomorrow (UTC)                              | 201 / 201                                                              |
| Bike                     | create with `1990-01-01`; `PATCH` unrelated field                    | 201 / 200 (no new restriction)                                         |
| Catalog (MT **and** oil) | `name: ""` and `"   "` on create                                     | 400 each                                                               |
| Catalog                  | `PATCH` `name: ""`                                                   | 400                                                                    |
| Catalog                  | create `" Chain Lube "`                                              | 201, stored `"Chain Lube"`                                             |
| Catalog                  | `"engine oil change"` after `"Engine Oil Change"` (TC-MT-004)        | 409                                                                    |
| Catalog                  | exact duplicate (TC-MT-003)                                          | 409 (unchanged)                                                        |
| Catalog                  | `PATCH` rename to a case-variant of another live row                 | 409                                                                    |
| Catalog                  | `PATCH` rename own row `"engine oil"` → `"Engine Oil"`               | 200                                                                    |
| Catalog                  | delete `"Foo"`, create `"FOO"`                                       | 201, **same `_id`**, name now `"FOO"` (revive, spec 41 behaviour kept) |
| Catalog                  | other user creates a case-variant of my name                         | 201 (per-user, spec 46)                                                |
| Catalog                  | wildcards: `"A_C"` next to `"ABC"`; `"A%"` next to `"AB"`            | 201 each — no false conflict                                           |
| Maint. log               | `serviceDate: 2020-01-01` on a 2024 bike (TC-ML-009)                 | 400, names the purchase date                                           |
| Maint. log               | `serviceDate` equal to the purchase date; `serviceDate` omitted      | 201 / 201                                                              |
| Maint. log               | `PATCH serviceDate` to before purchase / to after                    | 400 / 200                                                              |
| Maint. log               | `odometerReading` `-1`, raw `1e999`, `1000000` on create and `PATCH` | 400 each; bike odometer unchanged                                      |
| Maint. log               | valid create / `PATCH` still bump the odometer (spec 49)             | 201 / 200, `currentOdometer` follows                                   |

Run the new suite against the **old** `dist/` too (from `git archive HEAD dist`) and record the failures — a test that passes on both builds proves nothing.

Pass criteria: new suite fully green; `sqa.test.js` shows TC-BIKE-009, TC-MT-004, TC-MT-007, TC-ML-009 flipped to PASS with **no other status change** vs the 251 / 21 / 2 baseline from spec 49; `odometer.test.js` 40/40; `fuelodometer.test.js` 27/27; `odometerrace.test.js` 5/5; `yarn build` clean, `yarn lint` 0 errors and no new warnings.

Watch for: existing SQA fixtures that log maintenance before the bike's purchase date, or create catalog names with surrounding spaces — if a previously-passing case flips, it is either a fixture assumption to document or a real regression to fix; do not loosen the rule to make it pass.

---

## Explicitly NOT changing

- **Legacy case-variant duplicates already in the database stay.** Nothing renames or merges them; both rows keep working. To see whether any exist, per catalog: `SELECT "ownerId", lower(name), count(*) FROM maintenance_types WHERE "isDeleted" = false GROUP BY 1, 2 HAVING count(*) > 1;` (same for `engine_oil_types`). Merging would mean re-pointing logs — a data change that needs its own plan (spec 46 §0 H1 applies).
- **No functional unique index on `lower(name)`** — would fail on legacy duplicates. Revisit after the query above returns nothing.
- **Concurrency:** two simultaneous creates of `"A"` and `"a"` can both pass the check (no DB constraint covers case). Exact-case races are still caught by `P2002`. Accepted; same class of residual as spec 48's.
- **Moving a bike's `purchaseDate` later than its existing fuel/maintenance logs** is still allowed (and leaves them "before purchase"). Needs a decision (reject? ignore?) — separate spec.
- **Future-dated `serviceDate` / fuel `date`:** not part of DEF-13; logging a booked-ahead service is arguably legitimate.
- **`purchaseDate` lower bound** (e.g. 1900): not requested.
- **Other modules** with free-text names (`bikeIssue`, `bikeAccessory`) and the maintenance `cost`/`intervalKmUsed` fields.
- Client forms: no change.
- `dist/` is committed and goes stale — rebuild, and the fix reaches users only after redeploy.

## Rollout

1. Implement steps 1–6; `yarn build && yarn lint`.
2. Run the new suite on old and new builds, then the full regression.
3. Merge → deploy (rebuild `dist/`).
4. Optional operator step: run the legacy-duplicate query on production and decide whether to clean up.
5. Update the tracker, `TESTING_REPORT.md` (DEF-13 → fixed), Postman descriptions and `dummy-data.md`; flip this spec to ✅ Complete.

---

## Results (2026-10-10)

Local throwaway Postgres, server from the rebuilt `dist/`; the real Neon DB was not touched.

| Run | Before (old `dist/`) | After |
| --- | --- | --- |
| New `sqa-evidence/sanity.test.js` (36 cases: bike dates, both catalogs, maintenance dates + odometer) | 17 / 36 (19 real failures) | **36 / 36** |
| `sqa.test.js` (274 cases) | 251 pass / 21 fail / 2 skip | 255 / 17 / 2 — **only TC-BIKE-009, TC-MT-004, TC-MT-007, TC-ML-009 changed (FAIL → PASS)**, nothing else moved |
| `fuelodometer.test.js` (spec 48) | — | 27 / 27 |
| `odometerrace.test.js` (spec 49) | — | 5 / 5 |
| `odometer.test.js` | — | 40 / 40 |
| `yarn build` / `yarn lint` | clean / 0 errors, 23 warnings | clean / 0 errors, 23 warnings (no new) |

Notes:

- First run of the new suite on the new build: 30 / 36. Four failures were test-harness mistakes (the maintenance-log create response is the log itself, `data._id`, not `data.log._id`); two were **real** — the `ILIKE` wildcard false-409 described in §C, fixed by switching to `lower()`.
- The same exact-name `409` (TC-MT-003) and revive-by-name behaviour (TC-MT-014, spec 41) still pass — the revive path now matches ignoring case but keeps the row id.
- No existing SQA fixture needed changing.

### Not run (operator)

The legacy-duplicate query under "Not changing" against production; nothing in this spec writes production data.
