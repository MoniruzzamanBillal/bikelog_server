# Spec 62 — Lifetime mileage: per-year breakdown

**Status: Complete — implemented 2026-11-09 (code only; not pushed, not deployed).**

## Why

The app's Mileage **Lifetime** tab showed four aggregate tiles (total distance, fuel
used, fill-ups, average). The developer asked for a per-year breakdown there, the
Lifetime analogue of what the Yearly tab shows per-month: "in the lifetime tab page,
show yearly data, the information to show in the card will be same as the yearly tab's
per-month data." Paired with `bikelog_app` spec 66.

## What

`GET /bikes/:bikeId/mileage/lifetime` gains a **`yearlySummary`** array on its response.
Everything else on the response is byte-identical, so this is additive.

- Each entry: `{ targetYear, totalDistanceKm, totalLitersConsumed, totalFuelCost, fuelLogCount }`
  — the same `MileageSummary` shape the Monthly/Yearly endpoints already emit.
- **Newest year first.** Years run from the earliest fuel log's year to the latest
  fuel log's year, inclusive; a year in between with no logs still appears (zero-filled
  by `computeMileageForRange`, like the Yearly tab's empty months).
- Each year reuses **`computeMileageForRange(bikeId, Jan 1, Dec 31)`** — the exact engine
  the Monthly and Yearly endpoints use — so odometer anchoring (previous log, else the
  bike's immutable `initialOdometer`) and soft-delete handling can never drift from them.
- The no-fuel-log early return gains `yearlySummary: []`.

One file: `src/app/modules/mileageRecord/mileageRecord.service.ts` (`getLifetimeMileageFromDB`
+ a `YearlyMileageSummary` interface). No controller, route, schema or migration change.

## Hazards

- **H1 — one extra `computeMileageForRange` per year.** Each call issues a couple of
  Prisma reads, so lifetime latency now scales with the number of distinct years. For a
  personal tracker that is a handful of years; acceptable, and no worse per-year than the
  Yearly endpoint's 12 per-month calls. Not batched, to keep the anchoring logic shared.
- **H2 — `allLogs[0]` is the span start.** `allLogs` is fetched ascending, so `[0]` is the
  earliest fuel log; its year seeds the loop. Guarded by the `!latestFuelLog` early return
  above, so `allLogs` is non-empty whenever the loop runs.

## Cascade

**Step 3 not triggered.** Purely additive — the existing fields are unchanged, so
`bikelog_client-web-` reads the same response and needs no change.

## Verify (not run over HTTP)

- V1 — `yearlySummary` present, newest-first, one entry per year from first to last log.
- V2 — each year's figures match a hand-computed Jan–Dec `computeMileageForRange`.
- V3 — the flat totals (`totalDistanceKm` etc.) are unchanged from before this spec.
- V4 — a bike with no fuel logs returns `yearlySummary: []` and the zeroed totals.
- V5 — a year with no logs between two active years appears zero-filled, not skipped.
