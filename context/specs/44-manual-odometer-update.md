# 44: Manual odometer update (server)

Status: ✅ Complete — implemented and verified 2026-10-03.

Server half of a three-repo feature. App counterpart: `bikelog_client(app)/ai context/specs/47-settings-update-odometer.md`. Web counterpart: `bikelog_client(web)/context/specs/29-settings-update-odometer.md`. **This spec ships first** — the clients have nothing to call until it does.

---

## Goal

Let a rider record "my odometer is now X km" without logging a fuel fill-up or a maintenance entry.

Today `Bike.currentOdometer` is only changed by:

- `createBikeIntoDB` (`bike.service.ts`) — sets both `currentOdometer` and the immutable `initialOdometer`.
- `bumpOdometerIfHigher` (`bike.utils.ts`) — called from `fuelLog.service.ts:63` and `maintenanceLog.service.ts:109`.

`PATCH /bikes/:id` deliberately **strips** `currentOdometer` and `initialOdometer` (`updateBikeInDB`), so there is no existing path to reuse. That behaviour stays as is.

## Decisions (confirmed with the user)

| Question                                   | Decision                                                                               |
| ------------------------------------------ | -------------------------------------------------------------------------------------- |
| New value lower than the current odometer? | **Rejected.** Must be `>= currentOdometer`. 400 with the current value in the message. |
| Implementation style                       | New, additive endpoint. Existing endpoints and behaviour untouched.                    |

## Impact analysis — will this break or misread current behaviour?

No, as long as the new endpoint writes **only** `Bike.currentOdometer`. Every consumer of that field:

| Consumer                                              | How it uses the value                                      | Effect                                                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Reminders — `maintenanceLog.service.ts:291`           | `kmRemaining = nextDueOdometer - currentOdometer`          | Becomes accurate between fuel logs (the point of the feature). Overdue/upcoming may flip sooner — correct. |
| BikeCard, BikeDetailPage, RemindersBanner (app + web) | display / "overdue by" math                                | Show the new value.                                                                                        |
| AI prompt — `ai.service.ts:224`                       | text only                                                  | Uses the new value. AI insight caches key on log counts, not odometer, so no stale-cache issue.            |
| Fuel-log mileage closure — `fuelLog.service.ts`       | `previousFullTank.odometerReading`, `bike.initialOdometer` | **Unaffected** — uses log readings, never `currentOdometer`.                                               |
| Lifetime mileage — `mileageRecord.service.ts:230-240` | latest fuel-log reading − `initialOdometer`                | **Unaffected.** Lifetime km can lag the manual odometer until the next fuel log. Expected, not a bug.      |
| `bumpOdometerIfHigher`                                | raises only when `reading > currentOdometer`               | Still correct. A later log with a reading below the manual value simply does not bump.                     |

Safety properties:

- No schema change, no migration, no new table.
- A manual update creates **no** `FuelLog` and **no** `MileageRecord`, so mileage stats cannot be corrupted by it.
- Lower values are rejected, so `currentOdometer` stays monotonic and reminders cannot silently "un-overdue".
- Pre-existing, **not made worse**: fuel logs still do not validate their odometer against `currentOdometer` (DEF-04 in `TESTING_REPORT.md`).

---

## Endpoint

`PATCH /api/bikes/:id/odometer` — `authCheck` + `validateRequest`.

Request body: `{ "currentOdometer": 12345.5 }`

Success `200`: standard `sendResponse` envelope, message `"Odometer updated successfully"`, `data` = the bike in `toApiShape` form (`_id`, `owner`, `currentOdometer`, …) — the same shape as `GET /bikes/:id`, so clients can drop it straight into their bike cache.

| Status           | When                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------- |
| 400 (Zod)        | `currentOdometer` missing, not a number, or negative                                  |
| 400 (`AppError`) | `"Odometer can't be lower than the current reading (X km)"`                           |
| 404              | bike not found, not owned by the caller, or soft-deleted (via `findOwnedBikeOrThrow`) |
| 401              | missing or invalid token                                                              |

---

## Implementation

### Progress checklist

- [x] 1. Validation schema
- [x] 2. Service function
- [x] 3. Controller
- [x] 4. Route
- [x] 5. Housekeeping (Postman, progress tracker)
- [x] 6. Verification (`yarn build`, `yarn lint`, endpoint exercised)

### 1. Validation — `src/app/modules/bike/bike.validation.ts`

```ts
const updateOdometerSchema = z.object({
  body: z.object({
    currentOdometer: z
      .number({ required_error: "Odometer reading is required" })
      .nonnegative(),
  }),
});
```

Export it in `bikeValidations`. Zod's default unknown-key stripping applies (`validateRequest` reassigns the parsed body), so `initialOdometer` / `ownerId` in the body are dropped.

### 2. Service — `src/app/modules/bike/bike.service.ts`

Add `updateOdometerInDB(id, userId, newReading)`:

1. `const bike = await findOwnedBikeOrThrow(id, userId)` — reuses the existing 404 handling.
2. Conditional, atomic write so a concurrent fuel-log bump or a second request cannot lose an update (this deliberately avoids the DEF-01 read-modify-write race):

   ```ts
   const { count } = await prisma.bike.updateMany({
     where: {
       id: bike.id,
       ownerId: userId,
       isDeleted: false,
       currentOdometer: { lte: newReading },
     },
     data: { currentOdometer: newReading },
   });
   if (count === 0) {
     throw new AppError(
       httpStatus.BAD_REQUEST,
       `Odometer can't be lower than the current reading (${bike.currentOdometer} km)`,
     );
   }
   ```

3. Re-read with `findOwnedBikeOrThrow` and return `toApiShape(...)`.
4. Add `AppError` and `httpStatus` imports to this file; export `updateOdometerInDB` in `bikeServices`.

### 3. Controller — `src/app/modules/bike/bike.controller.ts`

`updateOdometer`: `catchAsync` + `sendResponse`, same shape as `updateBike`. Reads `req.params.id`, `req.user.userId`, `req.body.currentOdometer`.

### 4. Route — `src/app/modules/bike/bike.route.ts`

```ts
router.patch(
  "/:id/odometer",
  authCheck,
  validateRequest(bikeValidations.updateOdometerSchema),
  bikeController.updateOdometer,
);
```

No clash with `PATCH /:id` (different path depth).

### 5. Housekeeping

- `postman/bikelog-api.postman_collection.json` — add the request.
- `context/progress-tracker.md` — add an entry when implemented.

## Explicitly NOT changing

- `updateBikeInDB`'s stripping of `currentOdometer` / `initialOdometer`.
- `bumpOdometerIfHigher` and its call sites. (Optional follow-up spec: make it atomic with the same `updateMany … lt` pattern to fix DEF-01.)
- `initialOdometer` — never touched by this endpoint; it anchors lifetime distance.
- `dist/` — regenerated by `yarn build`, never hand-edited.

---

## Test plan

API-level (style of `sqa-evidence/sqa.test.js`):

1. Higher value → 200; `GET /bikes/:id` reflects it.
2. Equal value → 200 (idempotent).
3. Lower value → 400 with the message; DB unchanged.
4. Negative / string / missing body → 400.
5. Another user's bike → 404; soft-deleted bike → 404; no token → 401.
6. Mass assignment: `initialOdometer` / `ownerId` in the body are ignored.
7. Concurrency: 20 parallel updates with increasing values → final value equals the maximum.
8. Regression after a manual update: create a full-tank fuel log (reading above and below the manual value) → mileage record distance equals the log-based distance; `/reminders` `kmRemaining` uses the manual value; lifetime mileage unchanged.

Static: `yarn build` and `yarn lint` clean.

## Follow-up

SQA of this endpoint found two defects (accepts `Infinity`/absurd values; a concurrent fuel-log bump could overwrite a manual value). Both fixed in [`45-manual-odometer-hardening.md`](45-manual-odometer-hardening.md). Note the `bumpOdometerIfHigher` item below was resolved there too.

## Open items

- Should `bumpOdometerIfHigher` be made atomic in the same change, or as its own spec? (Recommended: separate spec — fixes DEF-01, outside this request.)
- No audit trail: only the latest value is stored. An odometer-history table would be a larger, separate change.
