# 57 — Fuel logs: cost per km per row

**Status**: ✅ Code complete — implemented 2026-10-19. `yarn build` clean, `yarn lint` 0 errors / 36 warnings
(pre-existing baseline, none in the touched file). Verified at **function level with Prisma stubbed — 13
assertions, green**: the three-row happy path, the newest row's nulls, the page-2 boundary, and two fills at
the same odometer reading. **Not exercised over HTTP.**
**Scope**: `bikelog_server/` only, one file — `fuelLog/fuelLog.service.ts` (`getFuelLogsFromDB` plus a new
local `withPeriodFields`) — plus the Postman description. No migration, no new route, no new query param.
**Companion**: `bikelog_app/ai context/specs/60-fuel-log-cost-per-km.md` (the card line).
**Purely additive** — two new keys on list rows only. `bikelog_client-web-` needs no change (cascade step 3
is not triggered): its fuel-log table renders a fixed column set and ignores unknown keys.

---

## Request

> in fuel log page , can you add the per km cost , just like the engine oil card sections in engine oil page ?
> if you can do it , then add this ..

The thing being pointed at is `EngineOilLogCard`'s last line — `1,240 km on this oil · ৳0.97/km` — which comes
from spec 54 D12's two derived list fields. Yes, it can be done, and the mechanism ports directly.

---

## Goal

Every fuel-log list row carries how far that tank actually took the bike and what the fill-up worked out to
per km, computed server-side so the figure does not change as the rider pages.

---

## Design

### Decisions

| # | Decision | Why |
| --- | --- | --- |
| D1 | A **direct port of `engineOilLog.service.ts`'s `withPeriodFields`**, "oil" → "fill" | The developer asked for exactly that line. Same pairing, same page-boundary query, same null rules. A shared helper was considered and rejected: the two differ in the date field they order by (`date` vs `changeDate`), the money field (`totalCost` vs `cost`) and the key names, so the "shared" version would be three parameters of configuration around four lines of arithmetic |
| D2 | A row's period is closed by its **newer** neighbour: `kmOnThisFill = next.odometerReading - this.odometerReading` | A tank is burned over the ride that *follows* the fill. The alternative (distance since the previous fill) would describe the money spent on the *previous* tank, which is the mileage convention, not the cost one |
| D3 | `costPerKm = totalCost / kmOnThisFill`, and **`null` when `kmOnThisFill` is 0** — never `Infinity` | Two fills can legitimately share an odometer reading (`assertOdometerInSequence` allows equal readings), and `Infinity` serialises as `null` through JSON anyway while breaking any arithmetic on the way there |
| D4 | **One extra query per list request** for the page's newest row's off-page neighbour | Without it, page 2's first row would read as having no figure and the page boundary would look like a bug — the defect engine oil's spec 54 V15 caught. Two queries per request in total, both served by existing indexes |
| D5 | The page is **re-sorted locally** (`date` desc, then `createdAt` desc) before pairing, rather than trusting adjacency in the returned array | Keeps the pairing correct if a caller passes `?sort=date`, and reproduces the `createdAt` tie-break `buildPrismaListQuery` appends — so two fills on one calendar day pair in the order the list shows them |
| D6 | `GET /:id` is **not** given the fields | Same as engine oil's: a single-row read has no neighbour in hand and the card that renders the line only ever comes from the list |
| D7 | `totalCost`, not `litersAdded * pricePerLiter` | It is a stored column (spec 04 computes it on write when the client omits it) and `toApiShape` already converts it from `Decimal`. Recomputing would be a second source of truth for the same money |

### Contract (additions only)

```
GET /bikes/:bikeId/fuel-logs            (list rows only)
  kmOnThisFill: number | null     // null on the newest fill-up — its tank is still being burned
  costPerKm:    number | null     // null when kmOnThisFill is null or 0
```

**This is money per km, not mileage.** km/l still comes exclusively from closed full-tank `MileageRecord`
periods under `/mileage`, which this spec does not touch — and unlike those, `costPerKm` counts partial fills
too, because every taka spent on fuel was spent whether the tank was filled or not.

---

## Hazards

| # | Hazard | Handling |
| --- | --- | --- |
| H1 | Read as mileage, `costPerKm` looks wrong to anyone comparing it with the km/l figure on the same card | Named for what it is, documented in Postman and in both clients' types, and the app's line sits under the odometer line rather than beside the km/l tag |
| H2 | A **backdated** fill-up inserted below the current newest row changes the neighbour of the row above it, so a previously-null figure appears and a previously-shown one moves | Correct behaviour — the period really did change — and the invalidation is already in place: every fuel-log mutation invalidates `["fuelLogs", bikeId]` in both clients |
| H3 | A deleted fill-up in the middle **widens** its neighbour's period | Same as H2, same invalidation. `isDeleted: false` is in both the list filter and the neighbour query, so a soft-deleted row never closes a period |
| H4 | The off-page neighbour query uses `date`/`createdAt` strictly greater-than, so a row tied on both would be missed | `createdAt` is insertion time and unique in practice — the same assumption `buildPrismaListQuery`'s tie-break already rests on |
| H5 | An odometer correction could make a neighbour's reading *lower*, giving a negative `kmOnThisFill` | Unreachable through the API: `assertOdometerInSequence` enforces a non-decreasing reading in date order on both create and update. A negative value could only come from a direct DB write, and would render as a negative distance rather than mislead |

---

## Implementation steps

1. `fuelLog.service.ts` — add `withPeriodFields(row, newerNeighbour)`. ✅
2. `fuelLog.service.ts` — in `getFuelLogsFromDB`: shape, local sort, the one off-page neighbour query, the
   `Map` of neighbours, and map the result through the helper. ✅
3. Postman — document both fields, the nulls, the boundary check and the not-mileage warning. ✅

---

## Test plan

| # | Check | State |
| --- | --- | --- |
| V1 | Three fills (9,000 → 9,400 → 9,700): the oldest reads 400 km / ৳2.50, the middle 300 km / ৳4.00 | ✅ stubbed |
| V2 | The newest row answers `null` for both | ✅ stubbed |
| V3 | `?page=2&limit=1` — the single row still carries 300 km, from the off-page neighbour | ✅ stubbed |
| V4 | Two fills at the same reading → `kmOnThisFill` 0, `costPerKm` null | ✅ stubbed |
| V5 | `GET /:id` carries neither field | ✅ by construction (the helper is only in the list path) |
| V6 | A live list over HTTP on a real bike, figures cross-checked by hand against two consecutive rows | ⬜ Postman |
| V7 | `?sort=date` (oldest first) pairs the same rows the same way | ⬜ Postman |
| V8 | `yarn build` + `yarn lint` clean | ✅ |
