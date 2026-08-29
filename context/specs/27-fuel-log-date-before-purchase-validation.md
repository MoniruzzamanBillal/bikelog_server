# 27: Reject Fuel Log Dates Before the Bike's Purchase Date

Status: ✅ Complete

## Goal

Per direct user request: if a bike was purchased 17 July, a fuel log dated 16 July (or any date before the bike's own `purchaseDate`) makes no real-world sense — the rider didn't own the bike yet — but the API currently accepts it silently. Reject it server-side with a clear `400` and a message stating why; both frontends already generically surface the backend's error message via toast, so no client-side code change is needed to satisfy "an appropriate toast message will be shown."

## Context

- `Bike.purchaseDate: Date` is already a real, always-present, user-set field (`bike.interface.ts`/`bike.model.ts`) — distinct from `Bike.createdAt` (the DB-record-insertion timestamp, which spec 26 is about; that's a separate, still-open bug about a different field being misused as a date anchor in mileage-period-closure math, not a business-rule validation like this one).
- `FuelLog.date` is optional at the Zod layer (`z.coerce.date().optional()`, defaulting to `new Date()` in the service if omitted) — this validation only meaningfully applies when a client actually supplies a `date`, since a log defaulting to "now" can never be before the bike's own purchase date (the bike must already exist, hence already have a `purchaseDate` in the past, for the log to be created at all).
- Confirmed both frontends already forward the backend's real error message to the user with zero extra work needed:
  - `bikelog_client-web-/utils/axiosInstance.ts`'s response interceptor: `message: error?.response?.data?.message || "Something went wrong"` → `FuelLogFormModal.tsx`'s catch block: `toast.error(message ?? "Something went wrong!!", ...)`.
  - `bikelog_app/utils/axiosInstance.ts`'s interceptor does the identical `error?.response?.data?.message || "Something went wrong"` normalization → `FuelLogFormModal.tsx`'s catch block: `Toast.show({type: "error", text1: error?.message || "Failed to save fuel log", ...})`.
  
  Whatever message this spec's `AppError` carries is exactly what the user will see in the toast on either client — no `bikelog_client-web-`/`bikelog_app` code changes are needed or planned as part of this spec.

## Design

### `src/app/modules/fuelLog/fuelLog.service.ts`

**`createFuelLogIntoDB`** — validate the resolved `date` (client-supplied or defaulted to now) against `bike.purchaseDate`, before building/inserting the document:

```ts
const createFuelLogIntoDB = async (
  bikeId: string,
  userId: string,
  payload: Partial<TFuelLog>,
) => {
  const bike = await findOwnedBikeOrThrow(bikeId, userId);

  const date = payload.date ?? new Date();

  if (date < bike.purchaseDate) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Fuel log date cannot be before the bike's purchase date (${bike.purchaseDate.toISOString().split("T")[0]})`,
    );
  }

  const totalCost = (payload.litersAdded ?? 0) * (payload.pricePerLiter ?? 0);

  const fuelLogData = {
    ...payload,
    bike: bikeId,
    totalCost,
    date,
  };

  const fuelLog = await fuelLogModel.create(fuelLogData);
  // ... rest unchanged
```

(`date` is now computed once and reused for both the validation check and `fuelLogData.date`, instead of being duplicated.)

**`updateFuelLogInDB`** — same check, only when the client actually supplies a new `date` in the PATCH body (an update that doesn't touch `date` shouldn't re-validate the existing, already-accepted value):

```ts
const updateFuelLogInDB = async (
  bikeId: string,
  userId: string,
  id: string,
  payload: Partial<TFuelLog>,
) => {
  const bike = await findOwnedBikeOrThrow(bikeId, userId);

  if (payload.date && payload.date < bike.purchaseDate) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Fuel log date cannot be before the bike's purchase date (${bike.purchaseDate.toISOString().split("T")[0]})`,
    );
  }

  // ... rest unchanged (existsInMileageRecord check, totalCost recompute, etc.)
```

(`findOwnedBikeOrThrow`'s return value was previously awaited but discarded in this function — now captured into `bike` since it's needed for the check. No other behavior of this function changes.)

**Same-day is allowed, not rejected** — the check is a strict `<`, so a fuel log dated exactly on the bike's own `purchaseDate` passes (you can log fuel the same day you bought the bike).

**Not touched by this spec**: `MaintenanceLog.serviceDate` has no equivalent check — out of scope, the user's request was specifically about fuel logs. `Bike.purchaseDate` itself has no lower/upper bound validation on bike create/update — also out of scope, not requested.

## Implementation

1. ✅ `src/app/modules/fuelLog/fuelLog.service.ts` — added the purchase-date check to `createFuelLogIntoDB` (computed-once `date` var) and `updateFuelLogInDB` (captured `bike` from the existing `findOwnedBikeOrThrow` call, conditional check on `payload.date`).
2. ✅ `postman/dummy-data.md` — added a note to the Fuel Logs section's field table and a short explanatory paragraph (matching the existing `totalCost` note's style) describing the new rule.
3. ✅ `context/progress-tracker.md` — marked this spec's row, In Progress → Complete.

## Dependencies

None new.

## Verify

- [x] `POST .../fuel-logs` with `date` before the bike's `purchaseDate` (16 July vs. a 17 July purchase) → `400`, message `"Fuel log date cannot be before the bike's purchase date (2026-07-17)"` — confirmed live.
- [x] `POST .../fuel-logs` with `date` equal to the bike's `purchaseDate` (17 July) → `201`, succeeds — confirmed live.
- [x] `POST .../fuel-logs` with `date` after the bike's `purchaseDate` (20 July), or omitted entirely (defaults to now) → both succeed — confirmed live.
- [x] `PATCH .../fuel-logs/:id` changing `date` to before the bike's `purchaseDate` (10 July) → `400`, same message — confirmed live.
- [x] `PATCH .../fuel-logs/:id` touching an unrelated field (`notes`) only, `date` omitted → `200`, succeeds normally — confirmed live.
- [x] `yarn build` clean; `yarn lint` — same pre-existing 14-warning/0-error baseline, no new issues.
- [~] Browser-based toast confirmation attempted but inconclusive for reasons unrelated to this fix's correctness: the already-running `bikelog_client-web-` dev server (started earlier in the user's own terminal) had `NEXT_PUBLIC_API_BASE_URL` inlined at its own process startup, before a later `.env` edit switched it from the deployed backend to `localhost:5000` — Next.js dev mode doesn't hot-reload `NEXT_PUBLIC_*` env values without a full server restart, so that running process was still silently talking to the deployed Vercel backend (confirmed: the exact same bike/user records are reachable via `https://bikelog-server.vercel.app`, proving local dev and the deployed API share the same underlying database) — which predates and doesn't have this validation. Replaying the browser's exact captured request payload directly against `localhost:5000` (the correct backend) via `curl` immediately confirmed the real `400` this spec's own live backend tests already established. Both frontends' toast plumbing (`error.message` forwarded verbatim from the backend's JSON body — confirmed by reading `bikelog_client-web-/utils/axiosInstance.ts` and `bikelog_app/utils/axiosInstance.ts`) is pre-existing, unchanged infrastructure already exercised successfully by every other error path on this exact form (e.g. the 409 "mileage record closed" case) — not new code introduced by this spec, so a live re-confirmation wasn't pursued further once the actual backend behavior was independently re-verified correct.
