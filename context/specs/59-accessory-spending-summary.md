# 59 — Accessory month-based spending summary endpoint

**Status**: ✅ Code complete — implemented 2026-11-04. `yarn build` clean, `yarn lint` no new findings (0 errors / 36 warnings, all pre-existing in `src/scripts/*`).
**Not exercised over HTTP** — the verification below needs the deployed server (or a Neon-backed dev run) and a bike with purchased accessories.
**Scope**: `bikelog_server/` only — one module (`src/app/modules/bikeAccessory/` service + controller + route) plus the Postman collection. No schema change, no migration, no new field on any existing endpoint.
**Purely additive**: a brand-new route; every existing response is byte-identical. **Cascade step 3 is not triggered** — `bikelog_client-web-` needs no change (it has no accessories screen that would consume this). Paired with **`bikelog_app` spec 61**, which is the whole reason this exists.

---

## Request

> "in the purchase tab of the accessories page, i want to see the month based spending, current month's spending … i dont see the total spending for all item, also i cant see the total spending of the current month."

The developer explicitly asked for this to be a **new backend API** the app consumes, rather than the app summing fetched rows client-side:

> "you should make new api for this then use this in the app"

---

## Problem

The app's accessories **Purchased** tab (`bikelog_app`) lists every purchased accessory but shows no money figure at all — only a count (`meta`). The rider cannot see a total across all purchases, this month's total, or which month each item was bought in. The existing `GET /bikes/:bikeId/accessories` endpoint is paginated (10/page) and returns no sums, so there is no server-side figure to show.

The data needed already exists on each row: `price Decimal?` and `purchaseDate DateTime?` (stamped once at the pending→purchased transition in `bikeAccessory.service.ts`, never re-stamped). What was missing was an endpoint to aggregate it.

---

## Endpoint

`GET /bikes/:bikeId/accessories/spending-summary` — `authCheck`, ownership-scoped via `findOwnedBikeOrThrow`.

Registered in `bikeAccessory.route.ts` **before** `GET /:id` so the literal path is not captured as an `:id` param.

Response `data`:

```ts
{
  allTimeTotal: number,          // Σ price over all purchased, non-deleted accessories
  currentMonth: string,          // "YYYY-MM", server-local time
  currentMonthTotal: number,
  months: Array<{                // newest-first; EVERY month from the earliest purchase
    month: string;               //   to the current month, empty ones included
    total: number;               //   (empty month → total 0, accessories [])
    accessories: TApiAccessory[]; // that month's items (toApiShape), newest-first
  }>
}
```

Empty case — a bike with no purchased accessories returns `allTimeTotal: 0`, `currentMonthTotal: 0`, `months: []`. The client renders its existing "wishlist is empty" state on an empty `months`.

---

## Implementation

One new service function `getAccessorySpendingSummaryFromDB(bikeId, userId)`:

- `bikeAccessory.findMany({ where: { bikeId, isDeleted: false, status: "purchased" }, orderBy: { purchaseDate: "desc" } })` — the same "only purchased counts as spending" filter the `spending` module uses.
- Bucket each row by `monthKey(purchaseDate ?? createdAt)` where `monthKey(d) = \`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}\`` — server-local time, the **same month-boundary convention** as `resolveSpendingDateRange` in `spending.service.ts`. **date-fns is not a server dependency**, so the month arithmetic is plain `Date`, matching house style.
- `Number(price)` with a `?? 0` null guard (Decimal must be wrapped in `Number(...)`).
- Build the month range by walking a first-of-month cursor **backwards** from the current month to the earliest purchase month, emitting a row per month — so the result is newest-first and every empty in-between month (and an empty current month) is present with `total: 0`.
- Each item mapped through the existing `toApiShape` helper, so the per-item wire shape matches what the app already knows (`_id`, `bike`, `price` as `number | null`).

### Design notes / hazards

- **H1 — empty months are filled server-side, on purpose.** The developer chose to see every month including zero-spend ones. Doing the calendar walk here (not in the client) keeps one source of truth for "which months exist" and lets the app render the gaps without re-deriving the range.
- **H2 — `purchaseDate` is the bucketing field, not `updatedAt`.** `updatedAt` moves on any later edit (price/name/image); `purchaseDate` is stamped once. `createdAt` is only a defensive fallback for a (shouldn't-happen) purchased row with a null `purchaseDate`.
- **H3 — month boundaries are server-local.** Identical to the existing spending endpoints, so `allTimeTotal` here must equal the spending-summary "Accessories" category at `period=lifetime`. A rider in a very different timezone could see a late-night purchase fall in the adjacent month versus the app's own local reckoning — accepted as consistent with the rest of the spending feature rather than introducing a second convention.
- **H4 — route ordering.** `/spending-summary` must precede `/:id` in the router, or `getBikeAccessoryById` would try to load an accessory with id `"spending-summary"` and 404.

---

## Verification

1. **Build/lint**: `yarn build` clean; `yarn lint` no new findings. ✅
2. **Postman** (`Accessory Spending Summary` request, added): 200; `data` has `allTimeTotal`, `currentMonth`, `currentMonthTotal`, and a `months` array.
3. **Correctness** (needs a bike with purchases, over HTTP — **not yet run**):
   - V1 `allTimeTotal` equals the sum of every purchased accessory's price.
   - V2 `currentMonthTotal` equals the sum of items purchased in the current `YYYY-MM`, and `0` when none.
   - V3 `months` is strictly newest-first and contiguous from the earliest purchase month to the current month, with no gaps; empty months carry `total: 0` and `accessories: []`.
   - V4 the current month is present even when it has no purchases.
   - V5 per-month `total` equals the sum of that month's `accessories[].price`.
   - V6 `allTimeTotal` equals the spending-summary "Accessories" category total at `period=lifetime` (cross-check).
   - V7 a bike with no purchased accessories returns `months: []` and zero totals.
   - V8 pending/cancelled accessories never appear and never contribute to any total.
