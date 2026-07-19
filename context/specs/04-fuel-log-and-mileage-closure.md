# Fuel Log + Mileage-Closure Trigger

## Goal

Implement `fuelLog` CRUD, and — this is the load-bearing part — the full-tank-to-full-tank mileage computation from `bike-log-plan.md` §2.1, which runs as a side effect of creating a fuel log and is what actually produces `MileageRecord` documents. `mileageRecord` itself (spec 05) is read-only; all the writing happens here.

## Design

**Ownership:** every endpoint takes `:bikeId`, calls `findOwnedBikeOrThrow(bikeId, req.user.userId)` (spec 03) first — 404s if not owned/doesn't exist.

**Server-computed `totalCost`:** the current `createFuelLogSchema` requires `totalCost` from the client, but it should never be trusted input — it's `litersAdded * pricePerLiter`, always. This spec proposes changing `fuelLog.validation.ts` to make `totalCost` optional/ignored in the create schema, and computing it server-side in `createFuelLogIntoDB` regardless of what's submitted. (Flagged since it's a validation-schema change, not just a service change.)

**`currentOdometer` bump:** after creating the fuel log, call `bumpOdometerIfHigher(bike, odometerReading)` (spec 03 helper).

**The mileage-closure algorithm** (`bike-log-plan.md` §2.1), run inside `createFuelLogIntoDB` after the new `FuelLog` is saved:

1. Find the most recent *prior* `FuelLog` for this bike with `isFullTank: true`, ordered by `date` descending (excluding the one just created). Call its `odometerReading` the `periodStartOdometer`. If none exists yet, use the bike's odometer reading as of bike creation as the implicit period start (i.e., the very first period runs from bike creation to the first full-tank fill — matches the plan's "you'll top off on day one" anchor assumption).
2. Sum `litersAdded` across all `FuelLog`s for this bike with `date` between `periodStartOdometer`'s log date (exclusive) and now (inclusive) — this is the "open period" accumulation.
3. **If the newly created log has `isFullTank === true`:** this closes the period. Create a `MileageRecord`:
   - `startOdometer = periodStartOdometer`, `endOdometer = odometerReading` (of the new log)
   - `distanceKm = endOdometer - startOdometer`
   - `litersConsumed` = the sum from step 2 (includes this fill)
   - `mileageKmPerLiter = distanceKm / litersConsumed`
   - `periodStartDate` / `periodEndDate` = the two closing fuel logs' `date` fields (not `createdAt`)
   - `fuelLogIds` = every `FuelLog` in the closed window, including this one
4. **If not a full tank:** no `MileageRecord` is created — the fill just sits in the open period, picked up by the next closure (or by spec 05's rolling-average fallback if no closure ever happens).

**Editing/deleting a fuel log that fed a closed `MileageRecord` — edge case, needs a rule:** once a `FuelLog` is referenced in some `MileageRecord.fuelLogIds`, editing its `odometerReading`/`litersAdded`/`isFullTank` or deleting it would silently desync that historical record. Proposed rule (simplest safe option, not the only option — flagged for you to confirm during review): **block** `updateFuelLog`/`deleteFuelLog` with `AppError(409, "This fuel log is part of a closed mileage record and can't be edited")` if `MileageRecordModel.exists({ fuelLogIds: fuelLogId })`. Alternative considered and rejected for MVP: cascading recompute of affected `MileageRecord`s — more correct but meaningfully more complex, deferred unless you actually hit this in practice.

**List endpoint:** unlike `bike`, fuel logs accumulate continuously (every fill-up). Proposes wiring in `Queryuilder` here — `sort()` defaulting to `-date` (not `-createdAt`, to respect back-logged entries) and `pagination()` — since this is the first module where result-set size actually matters.

## Implementation

1. `fuelLog.validation.ts`: make `totalCost` optional in `createFuelLogSchema` (or drop it entirely and compute-only).
2. `fuelLog.service.ts`:
   - `createFuelLogIntoDB(bikeId, userId, payload)`: ownership check → compute `totalCost` → save `FuelLog` → bump odometer → run closure algorithm → return the created log (optionally include whether a `MileageRecord` was closed, useful for the frontend to show "period closed!" feedback).
   - `getFuelLogsFromDB(bikeId, userId, query)`: ownership check → `Queryuilder(FuelLogModel.find({bike: bikeId}), query).sort().pagination()`.
   - `getFuelLogByIdFromDB`, `updateFuelLogInDB`, `deleteFuelLogFromDB`: ownership check + the closed-record edit/delete guard above.
3. `fuelLog.controller.ts`: wire real handlers.

## Dependencies

Spec 03 (`findOwnedBikeOrThrow`, `bumpOdometerIfHigher`).

## Verify-when-done

- [ ] `yarn build` / `yarn lint` clean.
- [ ] Sequence of partial fills followed by one full-tank fill produces exactly one `MileageRecord` with correct `distanceKm`/`litersConsumed`/`mileageKmPerLiter`.
- [ ] A back-logged fuel log (past `date`, entered today) is bucketed into closure math by `date`, not `createdAt`.
- [ ] Attempting to edit/delete a `FuelLog` already referenced by a `MileageRecord` returns 409, not a silent desync.
- [ ] `totalCost` in the saved document always equals `litersAdded * pricePerLiter`, even if the request tried to submit a different value.
- [ ] Fuel logs for bike A never appear in bike B's list, even for the same user.
