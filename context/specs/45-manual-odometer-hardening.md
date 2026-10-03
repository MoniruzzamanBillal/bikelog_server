# 45: Manual odometer hardening (server)

Status: ✅ Complete — both defects fixed and re-verified 2026-10-03.

Follow-up to `44-manual-odometer-update.md`. Found by `sqa-evidence/odometer.test.js` (TC-ODO-xxx) while testing the full backend before deploy.

---

## Defects

### DEF-15 (Critical) — `PATCH /bikes/:id/odometer` accepts `Infinity` and absurd magnitudes

- **Repro:** `PATCH /api/bikes/:id/odometer` with the raw body `{"currentOdometer":1e999}` → `200 "Odometer updated successfully"`. Also `1e300`, `1e15`.
- **Actual:** Postgres stores `Infinity` (double precision allows it). JSON cannot represent it, so every response then shows `"currentOdometer": null`. Because the endpoint (by design) rejects any lower value, and `bumpOdometerIfHigher` can never exceed `Infinity`, **the bike's odometer is permanently stuck** — reminders, the dashboard and the AI prompt all break for that bike, with no API path to recover.
- **Cause:** `updateOdometerSchema` is `z.number().nonnegative()`. Zod's `number()` accepts `Infinity`, and there is no upper bound.
- **Evidence:** TC-ODO-024, 025, 026. Probe output: `Infinity (1e999) -> 200 | stored: null`.
- **Fix:** `.finite().max(999999)`. 999,999 matches the cap both clients already enforce when *creating* a bike (`bike.schema.ts` in the web client), so no legitimate input is newly refused.

### DEF-16 (High) — a manual update can be silently undone by a concurrent fuel-log / maintenance-log save

- **Repro:** fire `PATCH .../odometer {5000}` in parallel with 8 `POST .../fuel-logs` carrying readings 1100–1170 → the odometer ends **below 5000 in 6/6 trials**.
- **Cause:** `bumpOdometerIfHigher` compares against the bike row read at the *start* of its own request, then writes unconditionally (`prisma.bike.update`). A bump that read `1000` earlier overwrites a freshly-set `5000` with `1100`. This is the known **DEF-01** lost-update race from `TESTING_REPORT.md`; spec 44 deliberately left it alone, but the SQA run shows it directly defeats the new feature (and `race.js` still reproduces it for plain fuel logs: 3–4 of 8 trials wrong).
- **Fix:** move the "only if higher" condition into the write — `updateMany({ where: { id, currentOdometer: { lt: newReading } }, data: { currentOdometer: newReading } })`. Same pattern spec 44 already uses. Signature and both call sites (`fuelLog.service.ts`, `maintenanceLog.service.ts`) are unchanged.
- **Evidence:** TC-ODO-042, TC-FUEL-026 (flaky by nature), `race.js`.

## Implementation

### Progress checklist

- [x] 1. `bike.validation.ts` — `updateOdometerSchema`: `.finite().max(999999)` with clear messages
- [x] 2. `bike.utils.ts` — make `bumpOdometerIfHigher` an atomic conditional write
- [x] 3. Rebuild `dist/` (`yarn build`)
- [x] 4. Re-run: `odometer.test.js` (all pass), full `sqa.test.js` (no regressions, TC-FUEL-026 stable), `race.js` (0 wrong trials), `behaviour.test.js`
- [x] 5. Docs: tracker, spec 44 cross-reference, `TESTING_REPORT.md` addendum

### 1. Validation

```ts
const updateOdometerSchema = z.object({
  body: z.object({
    currentOdometer: z
      .number({ required_error: "Odometer reading is required" })
      .finite("Odometer reading must be a finite number")
      .nonnegative()
      .max(999999, "Odometer reading can't exceed 999,999 km"),
  }),
});
```

### 2. Atomic bump

```ts
export const bumpOdometerIfHigher = async (
  bike: { id: string; currentOdometer: number },
  newReading: number,
) => {
  // ! the "only if higher" check lives in the write itself, not against `bike.currentOdometer`
  // ! (read earlier in the caller's request), so a concurrent write can't be overwritten with a stale lower value
  await prisma.bike.updateMany({
    where: { id: bike.id, currentOdometer: { lt: newReading } },
    data: { currentOdometer: newReading },
  });
};
```

## Explicitly NOT changing (found, reported, out of scope)

- **Pre-existing, same class:** `POST /bikes` with `currentOdometer: 1e999` (stores `Infinity`) and `POST /bikes/:id/fuel-logs` with `odometerReading: 1e999` (accepted, 201). Both belong to **DEF-04** (odometer validation) and are unchanged by specs 44/45.
- Bike-create and fuel-log schemas (no new bounds there).
- No data migration: `Infinity` could only have been written by the unfixed endpoint, which was never deployed.
- **Design consequence, not a bug:** because lower values are rejected, a typo that is still valid (e.g. `150000` instead of `15000`) cannot be undone through the API. Decided in spec 44; revisit only if users hit it.

## Verification

See checklist item 4. Pass criteria: `odometer.test.js` 40/40; `sqa.test.js` no new failures vs the 2026-10-03 baseline (247 pass / 25 fail / 2 skip) and TC-FUEL-026 passing; `race.js` reporting 0 wrong trials at both parallelism levels.

## Results (after the fix)

| Run | Before | After |
| --- | --- | --- |
| `odometer.test.js` (40 cases, TC-ODO-001…058) | 35 pass / 5 fail (024, 025, 026, 042 real; 056 was a test bug) | **40 / 40** |
| `sqa.test.js` (274 cases) | 247 pass / 25 fail / 2 skip | 247 / 25 / 2 — **identical statuses, no new failures** (the 25 are the known defects in `TESTING_REPORT.md`) |
| `race.js` (DEF-01 probe) | 3/8 and 4/8 trials wrong | **0/8 and 0/8** |
| TC-FUEL-026 (fuel-log odometer race) | passes only by luck | stable pass |
| `behaviour.test.js` | 15/15 | 15/15 |
| `yarn build` / `yarn lint` | clean / 0 errors, 16 known warnings | clean / 0 errors, 16 known warnings |

Three of the five initial failures were test-suite mistakes or cascades, fixed in `odometer.test.js` itself: 025/026 reused a bike that 024 had poisoned with `Infinity`, and 056 read the fuel-log id from the wrong response field (`data.fuelLog._id`).
