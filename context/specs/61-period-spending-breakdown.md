# 61 — Period spending breakdown endpoint (year/lifetime category → time buckets)

**Status**: ✅ Code complete — implemented 2026-11-08 (code only; **not pushed, not deployed**). `yarn build` clean, `yarn lint` unchanged on the spending module (0 new findings).
**Scope**: `bikelog_server/` only — the `spending` module (interface + service + controller + route) plus the Postman collection. No schema change, no migration.
**Purely additive**: a brand-new route and one new optional field (`liters`) on the internal `TSpendingRecord`. Every existing endpoint response is byte-identical. **Cascade step 3 is NOT triggered** — `bikelog_client-web-` needs no change (its Spending page renders the plain summary and has no accordion drill-down on any tab). Paired with **`bikelog_app` spec 65**, which is the whole reason this exists.
**Not exercised over HTTP** — V1–V8 below need the deployed server (or a Neon-backed dev run) and a bike with spending across months/years.

---

## Request

> "In the spending page, in month tab, you show category wise data and it is accordion … Now I want almost similar thing in the year and lifetime tab with some changes. In year tab … if I click in the category I should see per month data like, fuel show 9145.50, if I click accordion should open and it should show: Jan 3.3L 650taka. In the lifetime, when I click in a category the accordion should open and it should show: 2026: 225L 5678 taka."

The Month tab already has this (spec 60's `/monthly-breakdown`, category → nested line-item records). This spec is the Year/Lifetime analogue, but a category drills into **time buckets** (per-month for a year, per-year for lifetime) rather than individual records, and each bucket carries litres for the Fuel category.

## Design

`GET /bikes/:bikeId/spending-summary/period-breakdown?period=year&targetYear=YYYY` and `?period=lifetime`.

- `authCheck` + `findOwnedBikeOrThrow` — same ownership gate as every other spending route.
- `period` must be `year` or `lifetime`. **`month` is rejected** — the Month tab keeps `/monthly-breakdown`, whose records-shaped payload is different. `targetYear` required for `year`, ignored for `lifetime`.
- Reuses `computeSpendingForRange` (the shared fetch/category/record builder) so the date math and totals can never drift from the summary/details/monthly-breakdown endpoints. The new `getPeriodCategoryBreakdownFromDB` buckets the flat `records[]`:
  - **year** → bucket key `YYYY-MM`, label `Jan`…`Dec`, buckets sorted chronologically Jan→Dec.
  - **lifetime** → bucket key/label `YYYY`, buckets sorted newest-year-first.
- Litres: a new `liters: number | null` field on `TSpendingRecord` — `Number(litersAdded)` for a fuel record, `null` for maintenance/accessory/oil. A bucket's `liters` is the summed litres of its records (null if none); a category's `totalLiters` is the sum across buckets (null for any non-fuel category).

### Response shape

```
{
  period: "year" | "lifetime",
  targetYear?: string,
  totalSpending: number,
  categories: [
    {
      category: string,
      total: number,
      totalLiters: number | null,
      buckets: [ { key: string, label: string, total: number, liters: number | null } ]
    }
  ]
}
```

Categories derived from the records themselves (so a ৳0 Fuel bucket never appears, matching spec 60's reasoning) and sorted by `total` desc; per-category totals sum to `totalSpending`.

## Why no web change

The endpoint is new and every existing response is untouched, so nothing in `bikelog_client-web-` breaks. The web Spending page deliberately keeps its flat category summary (it has no accordion on any tab); porting the drill-down there is optional parity, not a forced cascade — not done in this spec.

## Files touched

- `src/app/modules/spending/spending.interface.ts` — `liters` on `TSpendingRecord`; new `TSpendingPeriodBucket`, `TSpendingPeriodGroup`, `TPeriodCategoryBreakdown`.
- `src/app/modules/spending/spending.service.ts` — `liters` set on all four record sources; new `getPeriodCategoryBreakdownFromDB`, exported.
- `src/app/modules/spending/spending.controller.ts` — `getPeriodBreakdown`.
- `src/app/modules/spending/spending.route.ts` — `GET /period-breakdown`.
- `postman/bikelog-api.postman_collection.json` — Year + Lifetime example requests.

## Verification (not run over HTTP)

- **V1** `period=year&targetYear=<year with spend>` → 200; each category's buckets are months Jan→Dec order; Fuel buckets carry `liters`, others `null`.
- **V2** `period=lifetime` → 200; buckets are years, newest-first.
- **V3** Sum of every category `total` === `totalSpending`.
- **V4** For a fixed year, this endpoint's `totalSpending` === `GET /spending-summary?period=year&targetYear=<year>`'s `totalSpending`, and each category `total` matches the summary's `categoryBreakdown`.
- **V5** `period=month` → 400 (`period must be one of: year, lifetime`).
- **V6** `period=year` with no `targetYear` → 400 (from `resolveSpendingDateRange`).
- **V7** Fuel `totalLiters` === sum of that year's fuel-log `litersAdded`; non-fuel `totalLiters` === `null`.
- **V8** A bike not owned by the caller → 403/404 via `findOwnedBikeOrThrow`.
