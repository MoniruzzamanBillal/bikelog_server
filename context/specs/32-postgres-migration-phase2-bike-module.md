# Postgres Migration — Phase 2: `bike` Module (+ the shared `bike.utils.ts` blast radius)

## Status

Proposed — not yet implemented. Second of the phased Mongoose→Prisma rewrites from `mongodb-to-postgres-migration-plan.md` (repo root). Depends on Phase 1 (spec 31) actually landing first — not just existing as a spec — see Design §E.

## Goal

Rewrite the `bike` module from Mongoose to Prisma. Unlike Phase 1's three standalone modules, `bike` has real fan-out: two of its own helper functions (`findOwnedBikeOrThrow`, `bumpOdometerIfHigher` in `bike.utils.ts`) are imported by **nine other modules** (`fuelLog`, `mileageRecord`, `maintenanceLog`, `bikeIssue`, `bikeAccessory`, `bikeDocument`, `bikeManual`, `spending`, `ai`) that all stay Mongoose-backed until their own later phases. This spec's central job is making that rewrite land without breaking any of those nine — verified call-by-call below, not assumed.

## Design decisions

### A. Response shape — field renames, not just `id` → `_id`

Same `_id` remap as spec 31 decision A, plus one new wrinkle specific to relational fields: `prisma/schema.prisma`'s `Bike.ownerId` is a clean relational FK name, but **both clients' `TBike` type requires the field to be called `owner`**, matching today's Mongoose `owner: ObjectId` field:

```ts
// bikelog_client-web-/components/(main)/Bike/type/bike.types.ts (and bikelog_app/types/bike.types.ts, confirmed identical)
export type TBike = { _id: string; owner: string; nickname: string; ... };
```

Every bike row returned to the client needs both remaps: `{ ...bike, _id: bike.id, owner: bike.ownerId }`. Leaving `id`/`ownerId` also present alongside `_id`/`owner` in the JSON is harmless (same tolerance ExpenseTracker's migration already relied on) — no need to strip them.

This field-rename pattern (Prisma's relational `xId` name vs. the client's pre-migration Mongoose field name) recurs in every later phase touching a model with a `@relation` — Phase 3 (`FuelLog.bikeId`→`bike`, `MileageRecord.bikeId`→`bike`) and Phase 4 (`MaintenanceLog.bikeId`→`bike`, `.maintenanceTypeId`→`maintenanceType`, `.oilTypeId`→`oilType`) both need the identical treatment — flagged once here, referenced there rather than re-derived.

### B. `bike.utils.ts` is a shared integration surface — redesign it to need zero changes in its 9 callers

Verified via grep, not assumed — every non-`bike` importer of `findOwnedBikeOrThrow`:

| Module | Usage |
|---|---|
| `fuelLog.service.ts` | ownership check + reads `.purchaseDate`, `.nickname`, `.initialOdometer`; calls `bumpOdometerIfHigher(bike, reading)` |
| `mileageRecord.controller.ts` | ownership check only (return value discarded) |
| `maintenanceLog.service.ts` | ownership check + reads `.nickname`, `.currentOdometer`; calls `bumpOdometerIfHigher(bike, reading)` |
| `bikeIssue.service.ts` | ownership check only (5 call sites, all discarded) |
| `bikeAccessory.service.ts` | ownership check, `const bike = ...` assigned but not used for anything Mongoose-specific |
| `bikeDocument.service.ts` | ownership check only |
| `bikeManual.service.ts` | reads `.manual`, then **mutates + `bike.save()`** — see §C, the one real breakage |
| `spending.service.ts` | ownership check only (3 call sites) |
| `ai.service.ts` | ownership check + reads `.nickname`(?) for context — never `.save()`s the returned bike |

None of these (`bikeManual` excepted, handled separately) touch anything beyond plain field reads or discard the return value entirely. This means the rewritten `bike.utils.ts` can keep its exact function names and call signatures and every one of these 8 modules keeps compiling and working, still fully Mongoose-backed for their own data, while transparently reading/writing `Bike` rows through Prisma:

```ts
// bike.utils.ts (Prisma version)
import { prisma } from "../../lib/prisma";
import httpStatus from "http-status";
import AppError from "../../Error/AppError";

export const findOwnedBikeOrThrow = async (bikeId: string, userId: string) => {
  const bike = await prisma.bike.findFirst({
    where: { id: bikeId, ownerId: userId, isDeleted: false },
  });
  if (!bike) throw new AppError(httpStatus.NOT_FOUND, "Bike not found");
  return bike; // plain Prisma row — NOT API-shaped (no _id/owner remap here, see note below)
};

export const bumpOdometerIfHigher = async (
  bike: { id: string; currentOdometer: number },
  newReading: number,
) => {
  if (newReading > bike.currentOdometer) {
    await prisma.bike.update({ where: { id: bike.id }, data: { currentOdometer: newReading } });
  }
};
```

`bumpOdometerIfHigher` deliberately keeps taking a `bike`-shaped object + `newReading` (not just a bare `bikeId`) — that's the exact shape every existing call site already has in hand (`fuelLog.service.ts`, `maintenanceLog.service.ts` both call it right after `findOwnedBikeOrThrow`), so **neither of those two call sites needs to change in this phase**, even though `fuelLog`/`maintenanceLog` themselves don't move to Prisma until Phases 3/4.

**Important:** `findOwnedBikeOrThrow`'s return value here is the *raw* Prisma row (`ownerId`, `id`, no `_id`/`owner` remap) — it's consumed internally by other services, not sent directly to an HTTP response in any of the 9 callers (confirmed by reading each one — they either discard it, read a scalar field like `.nickname`/`.currentOdometer`/`.manual`, or in `bikeManual`'s case return only the `.manual` sub-object, never the whole bike). `bike.service.ts`'s own controller-facing functions (`getBikeByIdFromDB` etc.) apply the A-decision remap separately, right before returning to their own controller.

### C. Required companion fix — `bikeManual.service.ts`'s `bike.save()` calls break immediately, not later

`uploadBikeManualIntoDB` and `deleteBikeManualFromDB` both do `bike.manual = {...}; await bike.save();` directly on the object `findOwnedBikeOrThrow` returns. The moment that function returns a plain Prisma row instead of a Mongoose document, both throw `TypeError: bike.save is not a function` — a live, already-shipped feature (spec 18's manual upload/chat) breaks on this phase landing, even though `bikeManual`'s own module (its `bikeManualChunkModel` Mongo usage) isn't scheduled to move until Phase 5. This can't be deferred — fix it as a small, bounded companion change in this same phase, touching only the two write paths:

1. Add one more export to `bike.utils.ts`:
   ```ts
   import { Prisma } from "@prisma/client";
   // ...
   export const updateBikeManual = async (
     bikeId: string,
     manual: TBikeManualMeta | null,
   ) => {
     return prisma.bike.update({
       where: { id: bikeId },
       data: { manual: manual === null ? Prisma.JsonNull : manual },
     });
   };
   ```
   Note the `Prisma.JsonNull` sentinel — passing plain JS `null`/`undefined` to a `Json?` column's `update` does **not** clear it the way you'd expect (Prisma treats `undefined` as "leave unchanged" and needs the special sentinel for "set to JSON null"). Easy to get silently wrong; call it out in review.
2. In `bikeManual.service.ts`, replace `bike.manual = {...}; await bike.save();` (upload path) and `bike.manual = undefined; await bike.save();` (delete path) with a call to `updateBikeManual(bikeId, manual)` / `updateBikeManual(bikeId, null)`. Nothing else in that file changes — `bikeManualChunkModel` (Mongo) stays exactly as-is until Phase 5.

### D. Known, accepted incoherence — `ai.service.ts` / `notification.service.ts` still read/write `Bike` via Mongo directly

Both import `bikeModel` (not `bike.utils.ts`) directly:
- `ai.service.ts`: `bikeModel.findByIdAndUpdate(bikeId, { aiSpendingInsight, aiSpendingInsightLogCount, ... })` — writes the AI-insight cache straight to Mongo.
- `notification.service.ts`: `bikeModel.find(...)` for the weekly-summary cron's bike list (already flagged for its `userModel` half in spec 31 — extending the same flag to its `bikeModel` half here).

Neither calls `.save()` on a `bike.utils.ts`-returned object, so neither **throws** after this phase — they keep working against Mongo, just silently disconnected from bikes created/updated through the now-Prisma-backed endpoints. Concretely: `ai.service.ts`'s insight-cache write becomes a no-op for any bike whose ID doesn't exist as a Mongo document (all bikes created after this phase, during local dev/testing) — `findByIdAndUpdate` returns `null` and does nothing, so caching silently stops working (every AI call regenerates instead of reading a cached value — wasteful OpenRouter usage, not user-facing broken). This is the same class of transient incoherence spec 31 already established as accepted-not-fixed until Phase 7; don't patch it here.

### E. Hard dependency on Phase 1: `Bike.ownerId` is a real Postgres foreign key

`prisma/schema.prisma`'s `owner User @relation(fields: [ownerId], references: [id])` becomes an actual FK constraint once migrated. `prisma.bike.create({ data: { ownerId: userId, ... } })` throws a foreign-key-violation error if no `User` row with that `id` exists in Postgres yet. Since Postgres starts empty and only gets `User` rows via Phase 1's Prisma-backed `/auth/register`, **testing this phase locally requires registering a brand-new user through the already-landed Phase 1 code first** — an old Mongo-only account's ID won't satisfy the FK until Phase 8's real data migration populates Postgres's `users` table. Not a bug to fix, just the expected order of operations — call it out in the verify checklist so it isn't mistaken for a broken FK relation.

### F. Soft delete (top-level plan decision #3)

`bike` is one of the 6 soft-delete collections. `findOwnedBikeOrThrow`, `getBikesFromDB` (`findMany`) both need explicit `isDeleted: false` (shown in §B's snippet). `deleteBikeFromDB` becomes `prisma.bike.update({ where: { id }, data: { isDeleted: true } })` and, matching current behavior, still returns the now-soft-deleted row (Mongoose's pre-find hook never filtered the direct result of an update call either — same effective behavior, not a change).

### G. `updateBikeInDB` — payload field stripping stays, `Object.assign`+`.save()` becomes a Prisma `update`

Current code deletes `owner`/`currentOdometer`/`initialOdometer` from the incoming payload before applying it (even though `currentOdometer` is technically a valid field in `updateBikeSchema` — the service layer blocks it from ever being written via this endpoint regardless; that's existing, deliberate behavior, port verbatim, don't "fix" it into being editable). Rewrite as:
```ts
const bike = await findOwnedBikeOrThrow(id, userId);
const allowedPayload = { ...payload };
delete allowedPayload.owner;
delete allowedPayload.currentOdometer;
delete allowedPayload.initialOdometer;
const updated = await prisma.bike.update({ where: { id: bike.id }, data: allowedPayload });
return toApiShape(updated);
```

### H. `createBikeIntoDB` — `owner` (Mongo field name) becomes `ownerId` (Prisma field name) on write, plus explicit ID

```ts
const startingOdometer = payload.currentOdometer ?? 0;
const bike = await prisma.bike.create({
  data: {
    id: generateObjectId(),
    ...payload,
    ownerId: userId,
    currentOdometer: startingOdometer,
    initialOdometer: startingOdometer,
  },
});
return toApiShape(bike);
```
(`payload` here is already validated request-body shape — it never contains an `owner`/`ownerId` key, matching current behavior where the client never sends one.)

## Implementation

1. `bike.utils.ts` — rewrite per §B, add `updateBikeManual` per §C.
2. `bike.service.ts` — rewrite all 5 functions (`createBikeIntoDB`, `getBikesFromDB`, `getBikeByIdFromDB`, `updateBikeInDB`, `deleteBikeFromDB`) per §F/G/H, add a small `toApiShape(bike)` helper (`{ ...bike, _id: bike.id, owner: bike.ownerId }`) used by every function that returns to a controller.
3. `bike.interface.ts` — `TBike.owner: ObjectId` → drop the Mongoose `ObjectId` import; either keep a slim create-payload type (per spec 31's ExpenseTracker-precedent pattern) or rely on Prisma's generated `Bike` type for read shapes.
4. `bike.model.ts` — **do not delete** (same rule as spec 31 §3 — `ai.service.ts`/`notification.service.ts` still import it; delete only once Phase 7 rewrites both).
5. `bikeManual.service.ts` — the two `bike.save()` call sites only, per §C. Nothing else in this file.
6. `bike.controller.ts` / `bike.route.ts` / `bike.validation.ts` — expected no-op, verify only.

## Files touched

- `src/app/modules/bike/bike.utils.ts` (rewrite)
- `src/app/modules/bike/bike.service.ts` (rewrite)
- `src/app/modules/bike/bike.interface.ts` (trim)
- `src/app/modules/bikeManual/bikeManual.service.ts` (two call sites only)
- Not touched: `bike.model.ts` (kept — see §4), every other importer of `findOwnedBikeOrThrow`/`bumpOdometerIfHigher` (unchanged by design, see §B), `ai.service.ts`/`notification.service.ts` (deferred, see §D).

## Out of scope for this phase

- `fuelLog`/`mileageRecord` — Phase 3.
- `maintenanceLog` — Phase 4.
- `bikeIssue`/`bikeAccessory`/`bikeDocument`/`bikeManualChunk`'s own Mongoose data — Phase 5 (only `bikeManual`'s two `.save()` call sites are touched here, out of necessity).
- `ai.service.ts` / `notification.service.ts` rewrites — Phase 7.
- Deleting `bike.model.ts` — blocked on Phase 7.

## Dependencies

Phase 1 (spec 31) must be **implemented and landed**, not just written — see Design §E.

## Verify-when-done

- [ ] `yarn build` / `yarn lint` clean.
- [ ] Register a fresh user via the Phase-1-rewritten `/auth/register` first (per §E), then `POST /api/bikes` with that user's token succeeds, row lands in Postgres `bikes` with a `generateObjectId()`-shaped `id`, response includes `_id` and `owner` (not `id`/`ownerId` only).
- [ ] `GET /api/bikes`, `GET /api/bikes/:id`, `PATCH /api/bikes/:id`, `DELETE /api/bikes/:id` all work against the Postgres-backed bike; soft-deleted bike disappears from list/get.
- [ ] `PATCH /api/bikes/:id` with `currentOdometer` in the body does **not** change `currentOdometer` (existing stripped-field behavior preserved).
- [ ] `POST /bikes/:bikeId/manual` (upload) and `DELETE /bikes/:bikeId/manual` still work end-to-end against the Postgres-backed bike — this is the regression check for §C; confirm `bike.manual` is actually persisted/cleared in Postgres, not silently failing.
- [ ] Spot-check (not a full flow, since `fuelLog`/`maintenanceLog` are still Mongo-backed until later phases): `POST /bikes/:bikeId/fuel-logs` and `POST /bikes/:bikeId/maintenance-logs` against a Postgres-backed bike still succeed and correctly bump `currentOdometer` in Postgres (proves `bumpOdometerIfHigher`'s new signature works from both still-Mongoose callers, per §B).
- [ ] `bikeIssue`, `bikeAccessory`, `bikeDocument`, `spending` endpoints for a Postgres-backed bike still return `404 Bike not found` correctly for someone else's bike (ownership check still works through the rewritten `findOwnedBikeOrThrow`), and succeed for the owner.
- [ ] Confirmed via manual check: `bike.model.ts` still present and unmodified; `ai`/`notification` endpoints still function against Mongo-backed bikes (proving this phase didn't silently break them, even though they'll misbehave for new Postgres-only bikes per §D — expected).
