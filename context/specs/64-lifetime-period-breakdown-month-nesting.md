# Spec 64 — Lifetime period breakdown: nest months under each year

**Status: Complete — implemented 2026-11-15 (code + `tsc`/lint verified; not run over HTTP).**

## Why

Drives `bikelog_app` spec 72. The app's Spending **Lifetime** tab shows each category's
per-year spending (via `GET /spending-summary/period-breakdown?period=lifetime`); the new
requirement is to drill one level further — tap a year, see that category's **per-month**
cost within it. Rather than have the app fire a second request per expanded year, the
lifetime response now carries each year bucket's months inside it, pre-bucketed server-side,
matching how the Year tab already receives fully-formed month buckets.

## What

`getPeriodCategoryBreakdownFromDB` in `modules/spending/spending.service.ts`, and the
`TSpendingPeriodBucket` type in `spending.interface.ts`. **One function, one type, no new
route, no migration, no query added** — it reuses the records already loaded by
`computeSpendingForRange`.

- `TSpendingPeriodBucket` gains `children?: TSpendingPeriodBucket[] | null`.
- While accumulating lifetime buckets, each record is folded into **two** accumulators from
  the same values: its year bucket (unchanged) and a month child under that year
  (`children`). Because both come from the same record in the same pass, a year total always
  equals the sum of its months for that category — it cannot drift.
- Output: a lifetime year bucket's `children` is its months sorted **Jan→Dec** (chronological)
  regardless of the newest-first order of the years themselves; each child carries
  `children: null`. A month bucket, and **every** `period=year` bucket, carries
  `children: null` — those are already the leaf grain.
- `totalLiters` (per category) and each year bucket's `liters` are still summed from the
  records directly, **not** from `children`, so there is no double counting.

## Hazards / decisions

- **H1 — additive only.** `children` is a new optional field. The app's Year tab ignores it;
  the web client does not consume `period-breakdown` at the month grain and is unaffected.
  Cascade step 3 is **not** triggered — no web change.
- **H2 — totals are by construction, not re-derived.** Months are a second fold of the same
  records, never a re-query, so the "year = Σ months" invariant holds with zero extra DB work
  and no second source of truth.
- **H3 — year period unchanged.** The `period=year` branch sets no `months` map, so its
  buckets serialize exactly as before (`children: null`). The Year tab's response is
  byte-compatible.

## Verify

Stubbed/static (done): `tsc --noEmit` clean, `eslint` clean on both files.

Not run (operator) — over HTTP against a bike with ≥2 calendar years of spending:
- V1 — `period=lifetime`: each category's year buckets each carry a non-empty `children`
  array of month buckets, ordered Jan→Dec.
- V2 — for any category+year, `Σ children[].total === yearBucket.total` to the paisa.
- V3 — `children[].liters` is populated only on the Fuel category, `null` elsewhere; the
  category's `totalLiters` is unchanged from before this spec.
- V4 — `period=year`: every bucket has `children: null` and the response is otherwise
  identical to pre-spec output.
