# 49: Close out DEF-01 — odometer lost-update race (verify, repair data, remaining gaps)

Status: ⏳ Not started.

Closes **DEF-01 (High)** from `TESTING_REPORT.md`: with concurrent fuel-log writes the bike's `currentOdometer` ended up _lower than the highest reading_ in 5/8 (5 parallel) and 6/8 (20 parallel) trials. Reminders (overdue/upcoming), lifetime mileage and the AI prompt's "Current odometer" all read that number.

**Scope: `bikelog-server` only.** No client change.

---

## 0. Read this first — the code fix already exists

DEF-01's fix shipped in **spec 45** (2026-10-03), recorded there as a side effect of fixing DEF-16 (same root cause). This spec does **not** re-do it. Verified on 2026-10-10:

- `src/app/modules/bike/bike.utils.ts › bumpOdometerIfHigher` is already an atomic conditional write:
  ```ts
  prisma.bike.updateMany({
    where: { id: bike.id, currentOdometer: { lt: newReading } },
    data: { currentOdometer: newReading },
  });
  ```
- The committed `dist/app/modules/bike/bike.utils.js` contains the same `updateMany` (lines 33–42).
- `master` contains it: spec 45 predates PR #23 (spec 46, merged 2026-10-10), which was deployed by `deploy.yml`.
- Spec 45's re-run of `sqa-evidence/race.js`: **0/8 and 0/8** wrong trials (was 3/8 and 4/8).

`TESTING_REPORT.md` is a snapshot taken _before_ that fix; it was run against the stale `dist/` described in its §8. So the report's DEF-01 row is out of date, not the code.

### What is actually still open (the reason this spec exists)

| #   | Gap                                                                                                                                                                                       | Why it matters                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| G1  | **Nobody has confirmed production serves the atomic version.** Evidence so far is the repo, not the running API.                                                                          | The report's own finding was "none of the fixes reach production until `dist/` is rebuilt".           |
| G2  | **Bikes corrupted by the old race keep a wrong `currentOdometer` forever.** The fix prevents new corruption; it never repairs old rows, and no API path lowers _or_ re-derives the value. | Wrong reminders / "overdue" status for exactly the users who double-tapped save.                      |
| G3  | **`PATCH /bikes/:id/maintenance-logs/:id` never bumps the odometer** when `odometerReading` is raised (create does). `fuelLog` update has the same gap — fixed by spec 48 §4, not here.   | Produces the same symptom DEF-01 describes (`currentOdometer` < highest reading) with no race at all. |
| G4  | **No checked-in regression guard.** `race.js` lives in the SQA folder outside `bikelog-server`, hard-codes `localhost:5055` and a fixed account, and nothing references it from the repo. | A future refactor of `bumpOdometerIfHigher` could silently reintroduce the bug.                       |
| G5  | `TESTING_REPORT.md` still lists DEF-01 as open.                                                                                                                                           | Misleads the next reader (it just misled this one).                                                   |

### Explicitly out of scope

- **DEF-12** (deleting the top log doesn't roll `currentOdometer` back) — opposite problem (too _high_), needs a rollback policy decision.
- **Concurrent fuel-log creates passing spec 48's ordering checks** — those validate by read-then-write. A per-bike serializable transaction / advisory lock is a separate hardening spec; see spec 48 "Not changing".
- Mileage-closure races (two simultaneous full-tank fills both computing a period) — different table, different failure mode.

---

## 1. Design

### A. Source of truth for the repair

For a non-deleted bike the _minimum correct_ odometer is:

```
expected = GREATEST(
  bike.currentOdometer,
  bike.initialOdometer,
  MAX(fuel_logs.odometerReading)         WHERE isDeleted = false,
  MAX(maintenance_logs.odometerReading)  WHERE isDeleted = false
)
```

- The repair **only ever raises** a value, never lowers one. That makes it safe against manual updates (spec 44), which can legitimately put `currentOdometer` above every log.
- Soft-deleted logs are ignored: a deleted reading must not push a bike's odometer up (and DEF-12 is a separate question).
- Rows already at `expected` are untouched, so the script is **idempotent** and safe to run repeatedly.

### B. Repair mechanism

A script with the same shape as `src/scripts/backfillCatalogOwners.ts` (spec 46): **dry run by default, `--apply` to write**, one connection through the existing `prisma` client, no run-state table. One `UPDATE` is atomic per row and uses `GREATEST`, so it also cannot clobber a manual update that lands mid-run.

### C. Maintenance-log update bump

In `updateMaintenanceLogInDB`, after a successful update where `payload.odometerReading !== undefined`, call `bumpOdometerIfHigher(bike, updated.odometerReading)`. It is the same atomic helper, a no-op if the reading was lowered or the bike is already higher, so it cannot introduce a new race.

### D. Regression guard

Keep it a **script, not a test framework** — `CLAUDE.md`: "No real test suite (`yarn test` is a stub)", verification is `yarn build` + `yarn lint` + exercising the endpoint. Move/adapt `race.js` into the repo as a parameterised script that takes `BASE_URL`, a bearer token (or email/password) from env, and exits non-zero on any wrong trial.

---

## 2. Implementation

### Progress checklist

- [ ] 1. Confirm production runs the atomic `bumpOdometerIfHigher` (G1)
- [ ] 2. `maintenanceLog.service.ts` — bump on update (G3)
- [ ] 3. `src/scripts/reconcileBikeOdometer.ts` — dry-run / `--apply` repair (G2)
- [ ] 4. Run the dry run against production, review, back up, `--apply`, re-run dry run (must report 0)
- [ ] 5. `src/scripts/checkOdometerRace.ts` — repo-local regression guard (G4)
- [ ] 6. `yarn build` + `yarn lint` (0 errors, no new warnings), rebuild `dist/`
- [ ] 7. Docs: `TESTING_REPORT.md` DEF-01 → fixed (G5), `progress-tracker.md`, spec 45 cross-reference, `CLAUDE.md` script mention

### 1. Confirm production (G1) — read-only

1. `git log master -- src/app/modules/bike/bike.utils.ts` must show the spec 45 commit, and `git diff master -- dist/app/modules/bike/bike.utils.js` must be empty on the deployed ref.
2. Check the last `deploy.yml` run on `master` succeeded for the commit that contains it.
3. Behavioural proof against the **live** API with a throwaway bike and user (clean up afterwards, per house convention): fire 20 parallel `POST /bikes/:id/fuel-logs` with readings 100, 110 … 290 and assert `GET /bikes/:id` returns `currentOdometer === 290`, repeated ~8 times. Step 5's script automates exactly this; run it against the production URL once it exists. If the live API still fails, the deploy is stale — redeploy (`yarn build`, push `master`), do not patch code.

### 2. `src/app/modules/maintenanceLog/maintenanceLog.service.ts` (G3)

`updateMaintenanceLogInDB` already loads the bike through `findOwnedBikeOrThrow`. After the `prisma.maintenanceLog.update(...)`:

```ts
if (payload.odometerReading !== undefined) {
  await bumpOdometerIfHigher(bike, updated.odometerReading);
}
```

(`bumpOdometerIfHigher` is already imported on line 7.) If the function discards the return of `findOwnedBikeOrThrow`, keep the value instead (`const bike = await findOwnedBikeOrThrow(...)`). No signature or response-shape change; no `// !` comment needed beyond one line pointing at spec 49 §C.

### 3. `src/scripts/reconcileBikeOdometer.ts` (G2)

Header comment in the style of `backfillCatalogOwners.ts` (usage block, idempotency note, "cannot run against local Postgres — needs a real Neon host", connection note about the pooled `DATABASE_URL`).

```ts
import { prisma } from "../app/lib/prisma";

const apply = process.argv.includes("--apply");

// ! raw SQL on purpose: one set-based statement, GREATEST() so the row can only move UP, and
// ! the per-row UPDATE is atomic — a manual odometer update landing mid-run can't be clobbered
const EXPECTED_SQL = `
  SELECT b.id, b."nickname", b."currentOdometer" AS current,
         GREATEST(
           b."currentOdometer",
           b."initialOdometer",
           COALESCE((SELECT MAX(f."odometerReading") FROM fuel_logs f
                      WHERE f."bikeId" = b.id AND f."isDeleted" = false), 0),
           COALESCE((SELECT MAX(m."odometerReading") FROM maintenance_logs m
                      WHERE m."bikeId" = b.id AND m."isDeleted" = false), 0)
         ) AS expected
    FROM bikes b
   WHERE b."isDeleted" = false`;
```

Flow:

1. **Phase 0 — guard:** abort if the `bikes` table/columns aren't there (cheap `SELECT 1 ... LIMIT 1`).
2. **Dry run (default):** run `EXPECTED_SQL`, keep rows where `expected > current`, print a table `bikeId | nickname | current → expected | delta`, plus a summary count. Writes nothing.
3. **`--apply`:** for each listed bike run
   `UPDATE bikes SET "currentOdometer" = $expected WHERE id = $id AND "currentOdometer" < $expected` and log rows-affected. The `AND currentOdometer < $expected` guard makes each write a conditional atomic update, same idea as `bumpOdometerIfHigher`.
4. Print the post-run count of still-wrong bikes (must be `0`).
5. `finally { await prisma.$disconnect(); }`, `process.exit` with a non-zero code on error — match the backfill script's exit handling.

Gotchas from spec 46's rollout, carry them over: the `PrismaNeon` adapter has failed to deserialise un-cast Postgres types before (it needed `::text` on `information_schema` columns). `Float` columns are plain `double precision` and should deserialise, but if `$queryRawUnsafe` errors on a column, cast it (`::float8`) rather than assuming the SQL is wrong. Use `$queryRaw`/`$executeRaw` with parameters for the `UPDATE`; do not interpolate ids into the string.

### 4. Running the repair

1. **Back up first** (Neon branch/point-in-time marker). The change is additive-only (values only increase), but the habit is spec 46's.
2. Dry run: `npx ts-node --transpile-only src/scripts/reconcileBikeOdometer.ts`. Review the list: every delta should be explainable by a fuel/maintenance log reading above the stored odometer. A bike whose `expected` is wildly larger than its other readings (e.g. an old typo `150000`) is a bad _log_, not a race victim — stop and look at that log before applying.
3. `--apply`.
4. Re-run the dry run: it must list **0** bikes. That is the pass condition.
5. Note the affected bike count in the tracker. If the count is 0, say so — that is a valid outcome (the race needed concurrent writes, so low-traffic data may be clean).

### 5. `src/scripts/checkOdometerRace.ts` (G4)

Parameters via env: `BASE_URL` (default `http://localhost:5000/api`), `RACE_EMAIL`, `RACE_PASSWORD`, `TRIALS` (default 8), `PARALLEL` (default `5,20`). Per trial: create a bike at odometer 0 → fire `PARALLEL` concurrent `POST .../fuel-logs` with readings `100 + i*10` and distinct backdated `date`s (so spec 26/48 ordering rules don't interfere — **dates must be strictly ascending with the readings**, else a spec 48 ordering rejection looks like a race) → read the bike → compare to the max reading → soft-delete the bike. Print `parallel=N: X/Y trials wrong`, exit `1` if any trial is wrong.

It is a manual verification tool, not part of `yarn build`. Add a one-line mention under Commands in `CLAUDE.md`. Because it creates data, it must only ever run against local/throwaway accounts — say so in the header comment.

---

## 3. Verification

| Check                                  | Pass criteria                                                                                                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yarn build`, `yarn lint`              | clean, 0 errors, no warnings beyond the known baseline                                                                                                                      |
| `checkOdometerRace.ts` vs local server | `parallel=5: 0/8`, `parallel=20: 0/8`                                                                                                                                       |
| `checkOdometerRace.ts` vs production   | same; throwaway bikes cleaned up                                                                                                                                            |
| Mutation check (prove the guard bites) | temporarily revert `bumpOdometerIfHigher` to read-then-write on a local branch → script reports wrong trials and exits 1; restore afterwards (do not commit)                |
| Reconcile dry run, before              | lists N bikes (N may be 0)                                                                                                                                                  |
| Reconcile dry run, after `--apply`     | lists 0 bikes; `currentOdometer` never decreased for any bike (compare to pre-run snapshot)                                                                                 |
| Maintenance update bump                | create a maintenance log at 1000, `PATCH` its `odometerReading` to 1500, `GET /bikes/:id` → `currentOdometer >= 1500`; `PATCH` it back to 900 → `currentOdometer` unchanged |
| Regression                             | `sqa-evidence`: `odometer.test.js` 40/40, `sqa.test.js` no new failures vs the 2026-10-03 baseline (247 / 25 / 2), `race.js` 0 wrong                                        |

## 4. Rollout

1. Implement §2 steps 2, 3, 5 on a branch. `yarn build && yarn lint`.
2. Run the race guard locally; do the mutation check.
3. Merge → deploy (rebuild `dist/` — it is committed and goes stale).
4. Run §2 step 1 against production, then §2 step 4 (backup → dry run → review → apply → dry run = 0).
5. Docs (§2 step 7). Flip this spec to ✅ Complete.

## 5. Docs to update on completion

- `context/progress-tracker.md` — spec table row (Not started → Complete with the one-line outcome incl. number of repaired bikes), Recent Activity entry.
- `TESTING_REPORT.md` — DEF-01 → _fixed in spec 45, verified on production in spec 49_, with the repair count.
- `context/specs/45-manual-odometer-hardening.md` — one-line cross-reference ("DEF-01 closed out in spec 49").
- `CLAUDE.md` — the two new scripts under Commands; note maintenance update now bumps the odometer (`Bike.initialOdometer vs. currentOdometer` bullet).
