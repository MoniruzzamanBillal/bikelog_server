# Bike CRUD

## Goal

Implement real logic for the `bike` module's five stub endpoints, and — since every nested resource (`fuelLog`, `maintenanceLog`, `spending`, `mileageRecord`) hangs off a `:bikeId` and must check ownership before touching anything — define the **shared ownership-check helper** and **shared `currentOdometer` bump helper** here, once, for specs 04/05/08/09 to reuse rather than re-deriving.

## Design

**Ownership model:** `Bike.owner` is the only authorization signal in this app (no roles). `req.user.userId` (typed via spec 02's `TJwtPayload`) is the authenticated user; every read/write must be scoped to `owner: req.user.userId`.

**Shared helper — `findOwnedBikeOrThrow(bikeId, userId)`** (proposed location: `src/app/modules/bike/bike.utils.ts`, exported for other modules to import):

```ts
const bike = await BikeModel.findOne({
  _id: bikeId,
  owner: userId,
  isDeleted: false,
});
if (!bike) throw new AppError(httpStatus.NOT_FOUND, "Bike not found");
return bike;
```

Returns 404 (never 403) whether the bike doesn't exist, belongs to someone else, or is soft-deleted — deliberately not distinguishing "not yours" from "doesn't exist" to avoid leaking existence of other users' bikes. `fuelLog`, `maintenanceLog`, `spending` all call this before doing anything with their own `:bikeId` param.

**Shared helper — `bumpOdometerIfHigher(bike, newReading)`**:

```ts
if (newReading > bike.currentOdometer) {
  bike.currentOdometer = newReading;
  await bike.save();
}
```

Called by `fuelLog` (spec 04) and `maintenanceLog` (spec 08) after creating a log with an `odometerReading` higher than the bike's current value. Never decreases `currentOdometer` (a back-logged entry with an older/lower reading shouldn't roll it backward).

**Per-endpoint logic:**

- `createBikeIntoDB(payload, userId)`: force `owner = userId` server-side regardless of what's in `payload` (validation schema doesn't accept an `owner` field today, but this is the belt-and-suspenders rule for if it ever does). `currentOdometer` defaults to 0 unless explicitly provided (e.g. user already has some km on the bike when they start logging).
- `getBikesFromDB(userId)`: `BikeModel.find({ owner: userId, isDeleted: false })`. No pagination/`Queryuilder` — a personal app's bike list is a handful of items, not worth the complexity.
- `getBikeByIdFromDB(id, userId)`: uses the shared ownership helper directly.
- `updateBikeInDB(id, userId, payload)`: ownership helper first, then `Object.assign` + `.save()` (so the `pre("save")` semantics apply consistently, rather than `findOneAndUpdate` bypassing hooks). `owner` and `currentOdometer` are never accepted from `payload` even if present (odometer changes only ever come from fuel/maintenance logs, never a direct edit — prevents a user from manually rolling back their own maintenance schedule).
- `deleteBikeFromDB(id, userId)`: ownership helper first, then `isDeleted = true; save()` (soft delete, matching the model's existing hooks). **No cascade** — child `FuelLog`/`MaintenanceLog`/`MileageRecord` rows are left as-is in the DB, but become unreachable through the API because every nested-resource lookup re-runs the ownership helper, which 404s once the parent bike is soft-deleted. This is a deliberate simplification: no orphan cleanup job, no cascading soft-delete, for MVP.

## Implementation

1. Create `bike.utils.ts` with `findOwnedBikeOrThrow` and `bumpOdometerIfHigher`.
2. `bike.service.ts`: implement all 5 functions per the "Per-endpoint logic" above, using `req.user.userId` passed in from the controller.
3. `bike.controller.ts`: replace each stub with a real `catchAsync` handler pulling `req.user.userId` / `req.params.id` / `req.body`, calling the service, responding via `sendResponse`.
4. No route/validation changes needed — `bike.route.ts` and `bike.validation.ts` from spec 01 already match this shape.

## Dependencies

Spec 02 (needs `req.user.userId` to be type-safe via `TJwtPayload`).

## Verify-when-done

- [ ] `yarn build` / `yarn lint` clean.
- [ ] Creating a bike as user A, then trying to `GET`/`PATCH`/`DELETE` it as user B, returns 404 (not 403, not a leaked 200).
- [ ] Soft-deleted bikes never reappear in `GET /bikes` or by direct `GET /bikes/:id`.
- [ ] `currentOdometer` cannot be set via `PATCH /bikes/:id` even if included in the request body (silently ignored, not a validation error — matches "extra fields ignored" zod behavior unless `.strict()` is used elsewhere).
- [ ] `findOwnedBikeOrThrow` importable from `fuelLog`/`maintenanceLog` modules without a circular-import issue (bike doesn't import back from them).
