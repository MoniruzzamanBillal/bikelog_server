# Spec 63 — Spending trend: calendar-year (Jan→Dec)

**Status: Complete — implemented 2026-11-09 (code only; not pushed, not deployed).**

## Why

The app's Spending **Trend** tab charted the rolling last-N-months window. The developer
wants a full calendar year: "in trend tab page, in the graph, you show only 6 month's
data … here i want to show 12 month's data from january to december." A rolling window
at any mid-year date reads e.g. "Dec → Nov", not "Jan → Dec", so it must be a fixed year.
Paired with `bikelog_app` spec 67.

## What

`GET /bikes/:bikeId/spending-summary/trend` gains an optional **`targetYear=YYYY`** query
param:

- With `targetYear`: returns that year's 12 months **Jan→Dec, chronological**, each
  `{ targetMonth, totalSpending, categoryBreakdown }` (the unchanged per-month shape), plus
  `targetYear` and `months: 12` on the envelope. Validated 2000–2100, else 400.
- Without `targetYear`: **unchanged** — the original rolling last-`months` window (default
  3, validated 1–24). Exactly one path runs; the controller decides and only the chosen
  path's validation applies.

Each month reuses `computeSpendingForRange(bikeId, start, end)`, so its totals and category
breakdown are identical to every other spending endpoint's.

Two files: `spending.controller.ts` (`getSpendingTrend` — read `targetYear` first) and
`spending.service.ts` (`getSpendingTrendFromDB` — signature widened from `months: number`
to `options: { months?: number; targetYear?: number }`). No schema or migration change.

## Hazards

- **H1 — `getSpendingTrendFromDB`'s signature changed.** Its only caller is this
  controller; grepped. A positional `months` caller would now break at compile time, which
  is the intended guard.
- **H2 — the web client calls this endpoint with `?months=…` only.** The rolling path is
  untouched and `targetYear` is optional, so the web bundle is unaffected (verified by the
  branch: no `targetYear` reference anywhere in `bikelog_client-web-`).

## Cascade

**Step 3 not triggered.** Additive query param; the rolling response shape and behaviour
are unchanged, so `bikelog_client-web-` needs nothing.

## Verify (not run over HTTP)

- V1 — `?targetYear=2026` returns 12 months Jan→Dec with `targetMonth` `2026-01`…`2026-12`.
- V2 — each month's `totalSpending` / `categoryBreakdown` matches a hand-computed range.
- V3 — no param → the old rolling `months` window, default 3, byte-identical to before.
- V4 — `?months=12` still works (rolling, not calendar) — the web contract is intact.
- V5 — `?targetYear=1999` and `?targetYear=abc` → 400.
