# 60 — Monthly spending breakdown endpoint (category + nested records)

**Status**: ✅ Code complete — implemented 2026-11-04 (code only; **not pushed, not deployed**). `yarn build` clean, `yarn lint` unchanged (0 errors / 36 warnings, all pre-existing in `src/scripts/*`).
**Scope**: `bikelog_server/` only — one module (`src/app/modules/spending/` service + controller + route + interface) plus the Postman collection. No schema change, no migration, no new field on any existing endpoint.
**Purely additive**: a brand-new route; every existing response is byte-identical. **Cascade step 3 is not triggered** — `bikelog_client-web-` needs no change (its Spending page renders the plain summary and has no accordion drill-down). Paired with **`bikelog_app` spec 62**, which is the whole reason this exists.
**Not exercised over HTTP** — V1–V7 below need the deployed server (or a Neon-backed dev run) and a bike with spending in the target month.

---

## Request

> "in the spending page, in the monthly spending tab … currently i m only seeing the category wise total spending, now i want to see category wise data + their details. Like: Fuel : 1230, 86.8% and it will be accordion, if i click this, then it will show the details of the category wise spending … Now make this … in backend, make separate api for my requirement and use in the monthly tab page … the other tab - year, lifetime, trend will be same as before."

The developer explicitly asked for a **separate backend API** feeding **only** the Month tab — the same instruction shape as spec 59 ("you should make new api for this then use this in the app"). Reference UX: `expenseTracker2`'s `TrendTab.tsx` — categories as accordions, each expanding to that category's transactions.

---

## Problem

The `spending` module already exposes everything *numerically*: `GET /spending-summary` returns `{ totalSpending, categoryBreakdown }` and `GET /spending-summary/details` returns the same plus a **flat** `records[]`. But neither shape is what an accordion wants. `/details` would force the client to re-group a flat array by `category` on every render, and it is period-generic (month/year/lifetime) where this feature is month-only. The developer asked for a dedicated endpoint rather than client-side regrouping, which is also the cleaner contract: the server already groups spending by category for the summary, so it should hand the records over already bucketed.

---

## Endpoint

`GET /bikes/:bikeId/spending-summary/monthly-breakdown?targetMonth=YYYY-MM` — `authCheck`, ownership-scoped via `findOwnedBikeOrThrow`.

- **`targetMonth` (YYYY-MM) is required.** There is **no `period` param** — this endpoint is month-by-definition (D1). A missing `targetMonth` is a 400 from the controller; a malformed one is the 400 `resolveSpendingDateRange` already throws.
- Response `data`:

```jsonc
{
  "period": "month",
  "targetMonth": "2026-07",
  "totalSpending": 1430,
  "categories": [
    {
      "category": "Fuel",
      "total": 1230,
      "records": [
        { "date": "2026-07-18T00:00:00.000Z", "category": "Fuel",
          "description": "3L @ ৳100/L", "amount": 300,
          "vendor": "Padma", "remarks": null, "source": "fuel" },
        { "date": "2026-07-12T00:00:00.000Z", "category": "Fuel",
          "description": "2L @ ৳100/L", "amount": 200,
          "vendor": null, "remarks": null, "source": "fuel" }
      ]
    },
    { "category": "Accessories", "total": 200, "records": [ /* … */ ] }
  ]
}
```

The record object is the existing `TSpendingRecord` unchanged — the client already knows it from `/details`.

---

## Implementation

Three files touched plus the interface and Postman.

1. **`spending.service.ts` — `getMonthlyCategoryBreakdownFromDB(bikeId, userId, targetMonth)`**. Reuses `resolveSpendingDateRange("month", targetMonth)` and `computeSpendingForRange` — so the date math and the per-record shape **can never drift** from the summary/details endpoints (the same reason those two already share `computeSpendingForRange`). It then groups the flat `records[]` into a `Map<category, { category, total, records }>`.

2. **`spending.controller.ts` — `getMonthlyBreakdown`**. Requires `targetMonth`; no period branch.

3. **`spending.route.ts`** — `router.get("/monthly-breakdown", authCheck, …)`. A distinct path, so no ordering concern against `/`, `/trend`, `/details`.

4. **`spending.interface.ts`** — `TSpendingCategoryGroup` + `TMonthlyCategoryBreakdown`.

---

## Hazards / decisions

- **H1 — categories are derived from `records`, NOT from `categoryBreakdown`.** `computeSpendingForRange` *unconditionally* pushes a `{ category: "Fuel", total: fuelTotal }` breakdown row even when `fuelTotal` is 0 (the summary view shows "Fuel ৳0 0.0%"). If this endpoint grouped off `categoryBreakdown`, a zero-fuel month would emit a `Fuel` bucket whose accordion expands to **nothing**. Grouping off the records themselves drops any category with no line items, and the per-category totals still sum to `totalSpending` because every cost lives in exactly one record (`fuel/maintenance/accessory/oil` records partition the total). This is a deliberate, small divergence from the summary's category list, and it is the correct one for a drill-down.

- **H2 — records are re-sorted newest-first within a category.** `computeSpendingForRange` returns records **oldest-first** (right for the PDF's chronological read). A drill-down wants the most recent spend first, matching the reference `TrendTab`. Sorted on a copy (`[...group.records]`) so the shared `computeSpendingForRange` result is not mutated.

- **H3 — `totalSpending` equals the summary's.** For the same `targetMonth`, this endpoint's `totalSpending` and the sum of its `categories[].total` both equal `GET /spending-summary?period=month`'s `totalSpending`. V6 checks this; it is the invariant that keeps the two tabs honest against each other.

- **D1 — no `period` param, month-only.** The feature is scoped to the Month tab by the developer; Year/Lifetime/Trend keep the summary endpoint. Keeping this endpoint month-only means it can't be misused to render a year's worth of records in one accordion list.

- **H4 — `Decimal` → `Number` already handled.** All arithmetic here operates on `record.amount`, which `computeSpendingForRange` already `Number(...)`-ed out of Prisma `Decimal`. No new `Decimal` is touched.

---

## Verification

Function-level type-safety only so far (`tsc` via `yarn build`). The following are **owed over HTTP** against a bike with spending in the target month:

- **V1** — `GET …/monthly-breakdown?targetMonth=<month with fuel + accessories>` → 200, `categories` ordered by `total` desc, each with nested `records`.
- **V2** — each category's `records` are newest-first (descending `date`).
- **V3** — missing `targetMonth` → 400 "targetMonth is required. Use YYYY-MM"; malformed (`2026-13`, `2026`, `july`) → 400.
- **V4** — a month with **no fuel logs** but other spending: no `Fuel` bucket appears (H1), and the remaining buckets' totals sum to `totalSpending`.
- **V5** — an empty month → `totalSpending: 0`, `categories: []` (the app renders its empty state).
- **V6** — `totalSpending` and `Σ categories[].total` both equal `GET /spending-summary?period=month&targetMonth=…`'s `totalSpending` to the paisa (H3).
- **V7** — another user's `bikeId` → 403/404 via `findOwnedBikeOrThrow` (ownership scoping).
