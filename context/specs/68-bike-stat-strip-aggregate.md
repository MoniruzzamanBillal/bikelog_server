# Spec 68 — Bike stat-strip aggregate endpoint

> Status: **planned** (backend only). Source: app request — the mobile bike-detail "stat strip" (`BikeStatStrip.tsx`) is a single component that today fires **four** separate GETs to paint itself; the developer wants one component → one API call.
> Cascade: this is the **server half**. Both clients consume it — `bikelog_app` spec **74** (primary target) and `bikelog_client-web-` spec **45** (the web hub renders the same strip from the same four endpoints). This endpoint is purely **additive**: no existing route, response shape, field, or status code changes, so nothing already shipped breaks.

## Why

`BikeStatStrip` (and the web client's `BikeDetailPage` hub) renders a handful of summary scalars for one bike: average mileage, this-month spend, lifetime spend, cost-per-km, and engine-oil status (km on the current oil, oil life %). To get them it currently calls four endpoints and does the final arithmetic client-side:

| Stat | Endpoint today | Client-side work |
| --- | --- | --- |
| Avg mileage | `GET /bikes/:bikeId/mileage` | mean of the 5 most recent `exactRecords`, else `approximate` |
| This-month spend | `GET /bikes/:bikeId/spending-summary?period=month&targetMonth=…` | read `totalSpending` |
| Lifetime spend | `GET /bikes/:bikeId/spending-summary?period=lifetime` | read `totalSpending` |
| Cost / km | (derived) | `lifetimeSpending / (currentOdometer − initialOdometer)` |
| Oil km / oil life % | `GET /bikes/:bikeId/engine-oil-logs/status` | read `kmSinceChange` / `percentUsed` when a change exists |

Four round-trips and duplicated math (the same `getAvgMileage` and `costPerKm` logic lives in both clients) to fill one row. **Goal:** one endpoint that returns exactly those scalars, computed server-side, so each client makes a single call and renders plain values.

## Decisions

1. **Lean computed scalars, not a bundle of the four raw payloads.** The response is the finished numbers the strip shows — not `TMileageHistoryResponse` + two `TSpendingSummary` + `TEngineOilStatus` re-wrapped. This is the smaller wire payload and removes the duplicated client math. (Developer chose this explicitly over a composite-of-sub-objects shape.)

2. **Compose the existing services; reimplement no query.** The new service calls the already-exported functions rather than touching Prisma directly:
   - `mileageRecordServices.getMileageRecordsFromDB(bikeId)` → compute the avg.
   - `spendingServices.getSpendingSummaryFromDB(bikeId, userId, "month", targetMonth)` → `monthSpending`.
   - `spendingServices.getSpendingSummaryFromDB(bikeId, userId, "lifetime")` → `lifetimeSpending`.
   - `engineOilLogServices.getEngineOilStatusFromDB(bikeId, userId)` → the oil scalars.
   This keeps a **single source of truth** for each number — the stat strip can never drift from the drill-down screen that owns the same figure.

3. **`avgMileage` logic is lifted verbatim from the client.** Mean of the 5 most-recent `exactRecords` by `periodEndDate` desc; else `approximate.mileageKmPerLiter`; else `null`. It moves server-side unchanged so the value is byte-identical to today's strip.

4. **`targetMonth` is a query param, defaulting to the server's current month.** Both clients already compute `format(now, "yyyy-MM")` for the month label; they pass it so the returned `monthSpending` always matches the month named in their label (avoids a UTC-vs-device month-boundary mismatch). Omitted → server uses its own current month.

5. **Oil scalars are `null` when and only when there is no oil change on record.** When `getEngineOilStatusFromDB` returns a non-null `lastChange`, `oil.kmSinceChange` / `oil.percentUsed` carry the numbers (including a legitimate `0`); when `lastChange` is `null`, both are `null`. This mirrors the client's current gate (`oilStatus?.lastChange ? … : null`) exactly, so the two oil stats hide for a bike with no oil history and show — even at 0 — for one with it.

6. **`costPerKm` is computed server-side from the owned bike's odometer delta.** `lifetimeSpending / (currentOdometer − initialOdometer)` when the delta is `> 0`, else `null`. The bike row is already in hand from the ownership guard (Decision 7), so no extra read. This matches both clients' current `costPerKm` formula.

7. **One ownership guard up front; the composed services re-guard harmlessly.** `findOwnedBikeOrThrow(bikeId, userId)` (`bike.utils.ts`) runs once — it both enforces access and yields the bike for `costPerKm`. `getSpendingSummaryFromDB` and `getEngineOilStatusFromDB` each re-run their own `findOwnedBikeOrThrow` internally; that is a few extra cheap indexed reads, accepted for the simplicity of reusing the high-level services. (If this ever shows up in latency, drop to the lower-level exported helpers `computeSpendingForRange` + `findLatestEngineOilLog`/`evaluateOilDue`, which skip the guard — **not** doing that now.)

8. **Fetch in parallel.** The four composed calls are independent → `Promise.all`, so the endpoint's latency is one slow call, not the sum.

## The endpoint — `GET /api/bikes/:bikeId/stat-strip`

- **Auth:** `authCheck` (reads `req.user.userId`).
- **Params:** `:bikeId` (via `mergeParams: true`).
- **Query:** `targetMonth?` — `"YYYY-MM"`; defaults to the current month. Validate shape loosely (a bad value falls back to current month rather than 400, matching the additive/non-breaking intent).
- **Response envelope** (`sendResponse`, HTTP 200):

```ts
// src/app/modules/bikeStats/bikeStats.interface.ts
export type TBikeStatStrip = {
  avgMileageKmPerLiter: number | null;
  monthSpending: number;       // for targetMonth (or current month)
  lifetimeSpending: number;
  costPerKm: number | null;    // null when (currentOdometer - initialOdometer) <= 0
  oil: {
    kmSinceChange: number | null;  // null ⇔ no oil change on record
    percentUsed: number | null;    // null ⇔ no oil change on record
  };
};
```

- **Errors:** `404 "Bike not found"` from the guard (not owned / missing) — same as every other bike-scoped route. `401` from `authCheck`.

## New module — `src/app/modules/bikeStats/` (route → controller → service, house pattern)

- **`bikeStats.route.ts`** — `Router({ mergeParams: true })`; `router.get("/", authCheck, bikeStatsController.getBikeStatStrip)`; `export const bikeStatsRouter = router`.
- **`bikeStats.controller.ts`** — `catchAsync`; read `req.params.bikeId`, `req.user.userId`, `req.query.targetMonth`; call the service; `sendResponse(res, { statusCode: 200, success: true, message: "Bike stat strip retrieved", data })`.
- **`bikeStats.service.ts`** — `getBikeStatStripFromDB(bikeId, userId, targetMonth?)`:
  1. `const bike = await findOwnedBikeOrThrow(bikeId, userId)`.
  2. `const month = targetMonth ?? format(new Date(), "yyyy-MM")` (or the repo's existing month helper).
  3. `Promise.all` the four composed calls (Decision 2).
  4. Reduce: `avgMileageKmPerLiter` (Decision 3), `monthSpending`/`lifetimeSpending` (`.totalSpending`), `oil` (Decision 5), `costPerKm` (Decision 6).
  5. Return `TBikeStatStrip`.
  Export via `const bikeStatsServices = { getBikeStatStripFromDB }`.
- **`bikeStats.interface.ts`** — the `TBikeStatStrip` type above.

**Register** in `src/app/router/index.ts` `routeArray`:
```ts
{ path: "/bikes/:bikeId/stat-strip", route: bikeStatsRouter },
```
(Place it near the other `/bikes/:bikeId/...` entries.)

## Cross-cutting server edits

None. No schema change, no migration, no change to `spending`/`mileageRecord`/`engineOilLog` behavior — the module only reads through their existing exported services. No `expenseTracker` interaction (read-only endpoint).

## Clients

- **`bikelog_app`** — consumes this endpoint; see app spec **74**. Replaces the four `useFetchData` calls in `BikeStatStrip.tsx` with one and deletes the client-side `getAvgMileage`/`costPerKm` math.
- **`bikelog_client-web-`** — consumes this endpoint; see web spec **45**. The web hub (`BikeDetailPage.tsx`) renders the same strip from the same four endpoints and duplicates the same math, so the cascade's step 3 *is* triggered here (the clients are additive consumers, not forced migrations — nothing breaks if a client lags, because the four old endpoints remain).

## Verification

- `npx prisma generate` (no schema change, but keep the habit) → `yarn build` (tsc clean) → `yarn lint` (no *new* findings) → `yarn test` (the Vitest suite is unaffected; this module is DB-calling so it isn't unit-tested — see below).
- **Not reachable by the unit suite.** `getBikeStatStripFromDB` composes `prisma`-calling services, which the `PrismaNeon` adapter can't point at local Postgres. So verification is **Postman against a Neon branch / production**, not a test.
- **Operator / Postman (not run here):** for a real `bikeId`, call `GET /api/bikes/:bikeId/stat-strip?targetMonth=<this month>` and assert each scalar equals the value from the endpoint it replaces:
  - `avgMileageKmPerLiter` == the mean the client computes from `GET …/mileage`.
  - `monthSpending` == `GET …/spending-summary?period=month&targetMonth=<this month>` `.totalSpending`.
  - `lifetimeSpending` == `GET …/spending-summary?period=lifetime` `.totalSpending`.
  - `oil.kmSinceChange` / `oil.percentUsed` == `GET …/engine-oil-logs/status` `kmSinceChange`/`percentUsed`.
  - **V1** a bike with **no** oil change → `oil.kmSinceChange` and `oil.percentUsed` are both `null`.
  - **V2** a bike with `currentOdometer == initialOdometer` → `costPerKm` is `null` (no divide-by-zero).
  - **V3** omitting `targetMonth` → `monthSpending` equals the current-month value.
  - **V4** another user's `bikeId` → `404`.
- **Deploy:** additive; no migration. `deploy.yml` ships it on push to `master`. No ordering constraint against the clients (old endpoints stay live), so server may deploy before or after the client builds.
