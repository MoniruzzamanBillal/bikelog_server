# Postgres Migration — Phase 3: `fuelLog` + `mileageRecord`

## Status

Proposed — not yet implemented. Third of the phased Mongoose→Prisma rewrites from `mongodb-to-postgres-migration-plan.md` (repo root). Depends on Phase 2 (spec 32) landed (bike must be Prisma-backed and its FK-satisfiable, per spec 32 §E's same reasoning one level down: `FuelLog.bikeId`/`MileageRecord.bikeId` are real FKs to `Bike.id`).

## Goal

Rewrite `fuelLog` and `mileageRecord` together, as the top-level plan groups them — they're interdependent (fuel-log full-tank closures create mileage records) and easiest to verify as one unit. This is the most logic-dense phase so far: the full-tank-to-full-tank mileage-closure algorithm in `createFuelLogIntoDB` has several non-obvious invariants (documented inline in the current code, spec 26's backdated-date fix among them) that must survive the rewrite exactly, not just "equivalently."

## Design decisions

### A. Field renames (same pattern as spec 32 §A)

`FuelLog.bikeId` / `MileageRecord.bikeId` (Prisma) → both clients require `bike` in the response (`TFuelLog.bike: string`, `TMileageRecord.bike: string`, `TMileageRecordClosed.bike: string` — all confirmed in both `bikelog_client-web-` and `bikelog_app`'s type files). Every returned row needs `{ ...row, _id: row.id, bike: row.bikeId }`.

### B. Decimal fields need `Number(...)` at every read — and one easy-to-miss arithmetic spot

`FuelLog.pricePerLiter`/`totalCost` are `Decimal(12,2)` per the top-level plan's decision #6. Two places need this, not just "the response":

1. **Every returned fuel log** — same `toApiShape` pattern as spec 32, extended: `{ ...row, _id: row.id, bike: row.bikeId, pricePerLiter: Number(row.pricePerLiter), totalCost: Number(row.totalCost) }`.
2. **`updateFuelLogInDB`'s recompute path** — this is the trap. Current code, when only one of `litersAdded`/`pricePerLiter` is patched, re-fetches the existing row and does `newPrice = payload.pricePerLiter ?? fuelLog.pricePerLiter; payload.totalCost = newLiters * newPrice`. After the Prisma rewrite, `fuelLog.pricePerLiter` off a freshly-fetched row is a `Prisma.Decimal` instance, not a plain number — multiplying it directly is unreliable (decimal.js objects don't do real arithmetic through JS's `*` operator). Convert explicitly: `const newPrice = payload.pricePerLiter ?? Number(fuelLog.pricePerLiter);` before the multiplication. Same trap doesn't exist in `createFuelLogIntoDB`'s `totalCost` computation (that one only ever reads from the raw request `payload`, which is plain JSON numbers, never a Decimal) — don't over-apply the fix where it isn't needed.
3. **The controller's `notifyExpenseTracker` call** (`amount: fuelLog.totalCost`) — only safe because the service's returned `fuelLog` already went through `toApiShape` (point 1) before the controller destructures it. Confirm this ordering holds after the rewrite — don't let a raw Prisma row leak past the service boundary into the controller.

### C. The mileage-closure algorithm — port every invariant, not just the shape

`createFuelLogIntoDB`'s full-tank branch (the block computing `mileageRecordClosed`) is the most subtle logic in this module — three invariants are already documented inline in the current code and must all survive:

- **Anchor on `bike.initialOdometer`, never `currentOdometer`**, when no prior full-tank fill exists — `currentOdometer` was just bumped by *this* fuel log via `bumpOdometerIfHigher` a few lines earlier, so using it would always collapse `distanceKm` to 0.
- **`$gt` on `periodStartDate`, not `$gte`** — the previous closing fill's liters already belong to the prior period; using `gte` would double-count them. Prisma: `date: { gt: periodStartDate, lte: fuelLog.date }`.
- **No lower date bound at all for the bike's first-ever period** (`periodStartDate === null` branch) — anchoring on `bike.createdAt` instead would wrongly exclude legitimately backdated fuel history entered after bike creation (this is spec 26's fix — regressing it would silently resurrect that bug). Prisma: `date: periodStartDate ? { gt: periodStartDate, lte: fuelLog.date } : { lte: fuelLog.date }`.

Mechanical translation, once the invariants above are preserved:

```ts
const previousFullTank = await prisma.fuelLog.findFirst({
  where: { bikeId, isFullTank: true, date: { lt: fuelLog.date }, isDeleted: false },
  orderBy: { date: "desc" },
});
// ...
const periodFuelLogs = await prisma.fuelLog.findMany({
  where: {
    bikeId,
    date: periodStartDate ? { gt: periodStartDate, lte: fuelLog.date } : { lte: fuelLog.date },
    isDeleted: false,
  },
  orderBy: { date: "asc" },
});
const fuelLogIds = periodFuelLogs.map((log) => log.id); // .id, not ._id — Prisma has no ._id
```

`.lean()` calls throughout this file (and `mileageRecord.service.ts`) are dropped entirely — Prisma always returns plain objects, there's no ODM-hydration cost to opt out of.

`mileageRecordModel.create({...})` → `prisma.mileageRecord.create({ data: { id: generateObjectId(), bikeId, ...fields, fuelLogIds } })` — `fuelLogIds` needs no type conversion (Mongo's `ObjectId[]` already serializes as plain strings; Prisma's native `String[]` is the same shape end to end).

### D. "Is this fuel log locked into a closed period" check — `$exists` on an array field

`updateFuelLogInDB`/`deleteFuelLogFromDB` both guard with `mileageRecordModel.exists({ fuelLogIds: id })` before allowing an edit/delete. Prisma's equivalent for "does any row have this value in its scalar array column" is the `has` filter, not `exists`:

```ts
const isLocked = await prisma.mileageRecord.findFirst({ where: { fuelLogIds: { has: id } } });
if (isLocked) throw new AppError(httpStatus.CONFLICT, "...");
```

### E. List endpoint (`getFuelLogsFromDB`) — the `Queryuilder` class has no Prisma equivalent; new shared helper needed

`Queryuilder` (`src/app/builder/Queryuilder.ts`) is built entirely around a mutable Mongoose `Query` object (`.find().sort().skip().limit().select()`, `.getFilter()` + `.model.countDocuments()` for the count). Prisma's query API is not chainable/mutable that way — `findMany({ where, orderBy, skip, take, select })` is one call. This module is the **first** of six current/future `Queryuilder` consumers to migrate (the others: `maintenanceLog` — Phase 4; `bikeIssue`, `bikeDocument` — Phase 5; `errorLog` — Phase 6), so this phase is where the replacement gets built, for reuse by all of them.

Build a small, Prisma-flavored equivalent — not a full generic class, just enough to replicate today's exact query-param contract (`sort`, `limit`, `page`, `fields`, arbitrary equality filters via other query keys) so this endpoint's client-observable behavior doesn't change:

```ts
// src/app/builder/buildPrismaListQuery.ts (new, shared — proposed name/location, confirm during implementation)
type ListQueryOptions = {
  baseWhere: Record<string, unknown>;   // the ownership-scoped filter, e.g. { bikeId, isDeleted: false }
  query: Record<string, unknown>;       // sanitized req.query (bike/isDeleted already stripped by the caller)
  defaultSort: string;                  // e.g. "-date" — matches today's per-module .sort("-date") call
};

export const buildPrismaListQuery = ({ baseWhere, query, defaultSort }: ListQueryOptions) => {
  const excluded = ["searchTerm", "sort", "limit", "page", "fields"];
  const extraFilters = Object.fromEntries(
    Object.entries(query).filter(([k]) => !excluded.includes(k)),
  );

  const sortStr = (query.sort as string) || defaultSort;
  const orderBy = sortStr.split(",").map((f) =>
    f.startsWith("-") ? { [f.slice(1)]: "desc" as const } : { [f]: "asc" as const },
  );

  const limit = Number(query.limit) || 10;
  const page = Number(query.page) || 1;

  return {
    where: { ...baseWhere, ...extraFilters },
    orderBy,
    skip: (page - 1) * limit,
    take: limit,
  };
};
```

**The IDOR-safe stripping pattern (CLAUDE.md, security-critical) moves unchanged, just one level earlier**: `fuelLog.service.ts`'s existing `delete sanitizedQuery.bike; delete sanitizedQuery.isDeleted;` still happens before calling this helper — the helper doesn't need to know about that rule specifically, it just merges whatever's left in `query` as equality filters, same as `Queryuilder.filter()` did. `getFuelLogsFromDB` becomes:

```ts
const sanitizedQuery = { ...query };
delete sanitizedQuery.bike;
delete sanitizedQuery.isDeleted;

const { where, orderBy, skip, take } = buildPrismaListQuery({
  baseWhere: { bikeId, isDeleted: false },
  query: sanitizedQuery,
  defaultSort: "-date",
});

const [result, meta] = await Promise.all([
  prisma.fuelLog.findMany({ where, orderBy, skip, take }),
  prisma.fuelLog.count({ where }),
]);

return { result: result.map(toApiShape), meta };
```

Two deliberate drops from the old `Queryuilder`, both confirmed dead weight: `.search()` (no caller ever passes `searchTerm` to `fuelLog`'s or `maintenanceLog`'s list endpoint — grep the routes/validations before assuming, but it's not wired to any query param in either module today) and `.field()`'s Mongoose `-__v` exclusion default (Prisma models have no `__v` version key at all — this becomes a pure no-op, so the `fields` query param, if ever actually used by a client, would need a real `select` mapping; flag as a knowingly-simplified corner rather than silently keep dead Mongoose-specific behavior).

### F. `mileageRecord.service.ts` reads `bikeModel` directly (not via `bike.utils.ts`) — in scope for this phase

Unlike the 9 modules listed in spec 32 §B, `mileageRecord.service.ts` imports `bikeModel` directly (`bikeModel.findById(bikeId).lean()`, twice — in `computeMileageForRange`'s no-prior-log fallback and in `getLifetimeMileageFromDB`) rather than going through `findOwnedBikeOrThrow`. Since `mileageRecord` itself is being rewritten in this same phase, this is simply folded into the rewrite — both become `prisma.bike.findUnique({ where: { id: bikeId } })`, reading `.initialOdometer` off the plain Prisma row. No cross-phase coordination needed here (contrast with spec 32 §D's `ai`/`notification` situation, which *is* cross-phase).

## Implementation

1. `fuelLog.service.ts` — rewrite all 7 functions (`createFuelLogIntoDB`, `getFuelLogsFromDB`, `getFuelLogByIdFromDB`, `updateFuelLogInDB`, `deleteFuelLogFromDB`, `uploadFuelLogImageIntoDB`, `deleteFuelLogImageFromDB`) per §A–E. `receiptImage` stays a `Json?` passthrough (decision #4 from the top-level plan) — no shape change, just no longer a Mongoose sub-schema.
2. `mileageRecord.service.ts` — rewrite all 6 exported functions per §A, §F; `computeMileageForRange` (the shared date-range helper `getMonthlyMileageFromDB`/`getYearlyMileageFromDB`/`getMileageTrendFromDB` all call) needs no algorithmic changes beyond dropping `.lean()` and switching query syntax — its actual math is untouched.
3. New shared file for §E's helper (exact path TBD during implementation — `src/app/builder/buildPrismaListQuery.ts` proposed).
4. `fuelLog.interface.ts` / `mileageRecord.interface.ts` — drop Mongoose `ObjectId` imports, `bike: ObjectId` → plain `bikeId: string` on the create-payload-shaped type.
5. `fuelLog.model.ts` / `mileageRecord.model.ts` — **do not delete**. Confirm no cross-module importer exists first (grep found none outside `fuelLog`/`mileageRecord`'s own files and `spending.service.ts`/`ai.service.ts`, which import `fuelLogModel` directly — see §G below) — so unlike spec 31/32's models, deletion here is blocked on Phase 7, same story.
6. `fuelLog.controller.ts` / `.route.ts` / `.validation.ts`, `mileageRecord.controller.ts` / `.route.ts` — expected no-op, verify only (note `mileageRecordController` calls `findOwnedBikeOrThrow` directly too — already Prisma-backed since Phase 2, no change here).

### G. Known, accepted incoherence — `spending.service.ts` / `ai.service.ts` still read `FuelLog` via Mongo directly

Both import `fuelLogModel` directly (`spending.service.ts` for its cost aggregation, `ai.service.ts` for `fuelLogModel.countDocuments(...)` feeding the cached-insight-regeneration check). Same class of issue as spec 32 §D: after this phase, any fuel log created through the new Prisma-backed endpoint won't be visible to `spending`'s totals or `ai`'s log-count cache-invalidation check until Phase 7 rewrites both. Not fixed here — Phase 7's job. Flagging now so it isn't mistaken for a regression when spending summaries look wrong against freshly-created-post-migration data during this phase's own local testing.

## Files touched

- `src/app/modules/fuelLog/fuelLog.service.ts` (rewrite)
- `src/app/modules/fuelLog/fuelLog.interface.ts` (trim)
- `src/app/modules/mileageRecord/mileageRecord.service.ts` (rewrite)
- `src/app/modules/mileageRecord/mileageRecord.interface.ts` (trim)
- `src/app/builder/buildPrismaListQuery.ts` (new)
- Not touched: `fuelLog.model.ts`, `mileageRecord.model.ts` (kept — blocked on Phase 7), `spending.service.ts`, `ai.service.ts` (deferred, §G), the original `Queryuilder.ts` (still used by `maintenanceLog` until Phase 4, `bikeIssue`/`bikeDocument` until Phase 5, `errorLog` until Phase 6 — don't delete it yet).

## Out of scope for this phase

- `maintenanceLog` — Phase 4 (will reuse `buildPrismaListQuery`).
- `bikeIssue`, `bikeAccessory`, `bikeDocument`, `bikeManualChunk` — Phase 5.
- `spending`, `ai`, `notification` rewrites — Phase 7 (§G).

## Dependencies

Phase 2 (spec 32) landed.

## Verify-when-done

- [ ] `yarn build` / `yarn lint` clean.
- [ ] Full fuel-log CRUD against a Postgres-backed bike; response includes `_id`/`bike` (not `id`/`bikeId` only); `pricePerLiter`/`totalCost` are JSON numbers, not `"150.00"`-style strings.
- [ ] Full-tank closure: create a sequence of fuel logs (partial, partial, full) against a fresh Postgres bike and confirm a `MileageRecord` is created with correct `startOdometer` (= bike's `initialOdometer`, not `currentOdometer`), correct `distanceKm`/`litersConsumed`/`mileageKmPerLiter`.
- [ ] Backdated-history regression check (spec 26): create a bike, then immediately log a full-tank fuel entry dated *before* the bike's `createdAt` timestamp — confirm it's still included in the first period's closure (this is exactly the bug spec 26 fixed; a regression here would be silent, not a crash).
- [ ] Editing/deleting a fuel log that's part of a closed `MileageRecord` → `409`, same message as today.
- [ ] `updateFuelLogInDB` recompute path: patch only `pricePerLiter` (not `litersAdded`) on an existing log and confirm `totalCost` recomputes to a correct number, not `NaN`/a string (the §B.2 trap).
- [ ] `mileageRecord` endpoints (`/`, `/monthly`, `/yearly`, `/lifetime`, `/trend`) all return correct figures against Postgres-backed fuel logs for a bike with real history.
- [ ] List endpoint sort/pagination (`GET .../fuel-logs?sort=-date&limit=5&page=2`) behaves identically to pre-migration behavior.
- [ ] Confirmed via manual check: `fuelLog.model.ts`/`mileageRecord.model.ts` still present and unmodified; `spending`/`ai` endpoints for a bike whose fuel logs were created *before* this phase (still in Mongo) continue to work.
