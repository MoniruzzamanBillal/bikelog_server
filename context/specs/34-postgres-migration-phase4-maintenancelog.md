# Postgres Migration — Phase 4: `maintenanceLog`

## Status

Proposed — not yet implemented. Fourth of the phased Mongoose→Prisma rewrites from `mongodb-to-postgres-migration-plan.md` (repo root). Depends on Phase 1 (spec 31 — `maintenanceType`/`engineOilType` in Postgres) and Phase 2 (spec 32 — `bike` in Postgres) both landed, per Design §D.

## Goal

Rewrite `maintenanceLog` — CRUD plus the `getReminders` read-model — from Mongoose to Prisma. This is the module the top-level plan explicitly calls out as depending on all three prior phases (`bike`, `maintenanceType`, `engineOilType`), and it's also where spec 31's "accepted incoherence" callout resolves: this phase is what fixes `maintenanceLog.service.ts`'s two `maintenanceTypeModel.findById(...)`/`engineOilTypeModel.findById(...)` calls that spec 31 explicitly left broken-by-design.

## Design decisions

### A. Field renames (same pattern as specs 32/33)

`MaintenanceLog.bikeId` / `.maintenanceTypeId` / `.oilTypeId` (Prisma) → clients require `bike` / `maintenanceType` / `oilType` (confirmed in both `bikelog_client-web-` and `bikelog_app`'s `TMaintenanceLog` type). Three renames on every returned row, not one:

```ts
const toApiShape = (log: /* Prisma MaintenanceLog row */ any) => ({
  ...log,
  _id: log.id,
  bike: log.bikeId,
  maintenanceType: log.maintenanceTypeId,
  oilType: log.oilTypeId,
  cost: Number(log.cost), // decision #6 — Decimal(12,2)
});
```

`partsReplaced: String[]` needs no conversion either side (native array both Mongo and Prisma, same JSON shape).

### B. Resolves spec 31's flagged incoherence — `maintenanceTypeModel`/`engineOilTypeModel` lookups become the real Prisma calls

Spec 31 §"Known, accepted incoherence" explicitly named this file's two `.findById(...)` calls as the reason `maintenanceType.model.ts`/`engineOilType.model.ts` couldn't be deleted after Phase 1. This phase is where that gets resolved — both calls become:

```ts
const maintenanceType = await prisma.maintenanceType.findUnique({ where: { id: payload.maintenanceTypeId } });
if (!maintenanceType) throw new AppError(httpStatus.NOT_FOUND, "Maintenance type not found");

if (payload.oilTypeId) {
  const oilType = await prisma.engineOilType.findUnique({ where: { id: payload.oilTypeId } });
  if (!oilType) throw new AppError(httpStatus.NOT_FOUND, "Engine oil type not found");
}
```

Keep this explicit existence check even though `MaintenanceLog.maintenanceTypeId`/`.oilTypeId` are also real Postgres FKs now (schema decision, same as spec 32 §E's `ownerId`→`User` FK) — letting the FK constraint itself throw would surface as an opaque `PrismaClientKnownRequestError` (`P2003`, foreign-key violation) instead of today's clean `404 Maintenance type not found` / `404 Engine oil type not found`. The application-level check exists specifically for that nicer error message, not for correctness the DB wouldn't otherwise enforce — port it, don't drop it as "redundant."

After this phase lands, re-check spec 31 §3's deletion note: `maintenanceType.model.ts`/`engineOilType.model.ts` can now be deleted **if** nothing else still imports them — re-grep before deleting (`notification.service.ts` doesn't touch either of these two, only `userModel`; confirm no other surprise importer exists at implementation time rather than assuming this list is exhaustive).

### C. `bumpOdometerIfHigher` call site — unchanged, per spec 32 §B's design

`createMaintenanceLogIntoDB` calls `bumpOdometerIfHigher(bike, payload.odometerReading!)` with the `bike` object `findOwnedBikeOrThrow` returned (already Prisma-backed since Phase 2). Spec 32 deliberately kept that function's signature stable specifically so this call site needs **zero changes** in this phase — confirm that still holds, don't "helpfully" touch it.

### D. Hard dependency on Phases 1 and 2 — three real FKs, not one

`MaintenanceLog.bikeId → Bike`, `.maintenanceTypeId → MaintenanceType`, `.oilTypeId → EngineOilType` (optional) are all real Postgres foreign keys. Creating a maintenance log requires all three referenced rows to already exist in Postgres — meaning local testing needs, in order: a Phase-1-registered user → a Phase-2-created bike → Phase-1-seeded (`yarn seed:maintenance-types`/`seed:engine-oil-types`, rewritten per spec 31 §Implementation.5) maintenance-type/engine-oil-type rows. Same "expected order of operations, not a bug" framing as spec 32 §E — call out explicitly in the verify checklist.

### E. `getRemindersFromDB` — port the grouping logic verbatim; one pre-existing shape question, not this phase's to fix

The `latestPerType` grouping (`Map` keyed by `log.maintenanceType.toString()`, keeping only the first — i.e., most recent, since the query is already sorted `-serviceDate` — log per type) translates directly: `log.maintenanceTypeId` is already a plain string off a Prisma row, so the `.toString()` call is simply dropped (was only ever needed to coerce a Mongoose ObjectId to a string; nothing left to coerce). The overdue/upcoming threshold math (`kmRemaining <= 0` / `<= 50`, `daysRemaining <= 0` / `<= 14`) is pure JS arithmetic, untouched by the DB swap — port as-is.

**Separately observed, not part of this migration's scope**: the client's `TReminder.maintenanceType` type is `{ _id: string; name: string }` (an object), but the actual service code returns `reminder.maintenanceType = log.maintenanceType` — today, a bare Mongoose ObjectId (serializes as a plain string, no `.populate()` anywhere in this file); after the rewrite, `log.maintenanceTypeId`, still a plain string. This looks like a pre-existing mismatch between what the client type declares and what the server has always actually sent, unrelated to the Postgres migration. Per this project's own "port behavior verbatim, don't drive-by fix" convention (same rule ExpenseTracker's migration spec used), leave it exactly as-is — flag it to the user as a `Known Gaps` entry in `progress-tracker.md` if it isn't already tracked there, rather than silently changing response shape mid-migration.

### F. List endpoint — reuse Phase 3's `buildPrismaListQuery`, same IDOR-stripping pattern

`getMaintenanceLogsFromDB` is structurally identical to `fuelLog`'s rewritten list endpoint (spec 33 §E) — same `delete sanitizedQuery.bike; delete sanitizedQuery.isDeleted;` stripping before merging as filters, same `buildPrismaListQuery({ baseWhere: { bikeId, isDeleted: false }, query: sanitizedQuery, defaultSort: "-serviceDate" })` call, same `Promise.all([findMany, count])` pair. This is the second (of four eventual: `maintenanceLog` now, `bikeIssue`/`bikeDocument` Phase 5, `errorLog` Phase 6) consumer of that shared helper — no new design needed here, just confirm the helper (built in Phase 3) is generic enough as-is; if this phase's implementation finds it isn't, adjust the helper itself rather than forking a second copy.

### G. `updateMaintenanceLogInDB` — two-step find-then-update, `nextDueOdometer` recompute logic untouched

Current code: fetch via `findOne` (ownership+ID scoped), conditionally re-validate `maintenanceType`/`oilType` if being changed, recompute `nextDueOdometer` only when `odometerReading` or `intervalKmUsed` changed AND a resulting `intervalKmUsed` value exists, then `Object.assign` + `.save()`. Rewrite the mutation as `prisma.maintenanceLog.update({ where: { id }, data: updateData })` after the same two-step scoped-find-first pattern (mirrors spec 32 §G's `updateBikeInDB`) — the recompute math (`computeNextDueOdometer`) is pure arithmetic, untouched.

## Implementation

1. `maintenanceLog.service.ts` — rewrite all 8 exported functions (`createMaintenanceLogIntoDB`, `getMaintenanceLogsFromDB`, `getMaintenanceLogByIdFromDB`, `updateMaintenanceLogInDB`, `deleteMaintenanceLogFromDB`, `getRemindersFromDB`, `uploadMaintenanceLogImageIntoDB`, `deleteMaintenanceLogImageFromDB`) per §A–G. `serviceImage` stays a `Json?` passthrough, same as `fuelLog.receiptImage` in Phase 3.
2. `maintenanceLog.interface.ts` — drop Mongoose `ObjectId` imports; `bike`/`maintenanceType`/`oilType: ObjectId` → `bikeId`/`maintenanceTypeId`/`oilTypeId: string` on the create-payload-shaped type.
3. Re-check `maintenanceType.model.ts`/`engineOilType.model.ts` deletion per §B once this lands.
4. `maintenanceLog.model.ts` — **do not delete** yet if anything outside this module still imports it (re-grep at implementation time — none found as of this spec's writing, but confirm rather than assume).
5. `maintenanceLog.controller.ts` / `.route.ts` (both `crudRouter` and `reminderRouter`) / `.validation.ts` — expected no-op, verify only.

## Files touched

- `src/app/modules/maintenanceLog/maintenanceLog.service.ts` (rewrite)
- `src/app/modules/maintenanceLog/maintenanceLog.interface.ts` (trim)
- Possibly deleted (pending §B's re-grep): `src/app/modules/maintenanceType/maintenanceType.model.ts`, `src/app/modules/engineOilType/engineOilType.model.ts`
- Not touched: `maintenanceLog.model.ts` (kept, pending confirm), `src/app/builder/buildPrismaListQuery.ts` (reused from Phase 3, not modified unless §F's genericity assumption turns out wrong).

## Out of scope for this phase

- `bikeIssue`, `bikeAccessory`, `bikeDocument`, `bikeManualChunk` — Phase 5.
- `errorLog` (decision #10 still open) — Phase 6.
- `spending`, `ai`, `notification` — Phase 7. Note: `spending.service.ts` also directly imports `maintenanceLogModel` (for cost aggregation) — same accepted-incoherence class as spec 33 §G, now also true for maintenance logs created post-this-phase; not fixed here.
- The `TReminder.maintenanceType` shape question from §E — flag to progress-tracker's Known Gaps, don't fix inline.

## Dependencies

Phase 1 (spec 31) and Phase 2 (spec 32), both landed.

## Verify-when-done

- [ ] `yarn build` / `yarn lint` clean.
- [ ] Order-of-operations check (§D): fresh Postgres user → bike → seeded maintenance-type/engine-oil-type rows, then full maintenance-log CRUD succeeds against all of them.
- [ ] Creating a maintenance log with a bogus `maintenanceTypeId`/`oilTypeId` → clean `404`, not a raw Prisma FK-violation error (§B).
- [ ] `cost` in every response is a JSON number, not a `"450.00"`-style string.
- [ ] `nextDueOdometer` recompute: create a log with `intervalKmUsed`, confirm `nextDueOdometer = odometerReading + intervalKmUsed`; patch `odometerReading` only, confirm it recomputes correctly (§G).
- [ ] `GET /bikes/:bikeId/reminders`: create logs across ≥2 maintenance types with due odometer/date thresholds crossed, confirm `overdue`/`upcoming` classification matches pre-migration behavior exactly (§E).
- [ ] List endpoint sort/pagination/IDOR-stripping (`?bike=<otherBikeId>` in the query string must not leak another bike's logs) — same check spec 33 ran for `fuelLog`, repeat here.
- [ ] `bumpOdometerIfHigher` still bumps `Bike.currentOdometer` correctly from this module's create path (§C).
- [ ] Confirm whether `maintenanceType.model.ts`/`engineOilType.model.ts` were actually deleted or kept, and that the reasoning (re-grep result) is recorded in the PR/commit, not just assumed from this spec.
