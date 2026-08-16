# 22: Trend Endpoints — 6-Month Window

Status: ⛔ Not started

## Goal

`bikelog_client-web-` is moving its Spending/Mileage trend charts from a hardcoded `?months=3` to `?months=6` (its own spec 20). `bikelog_app` is removing its trend charts entirely (its own spec 25). This spec exists to answer, for the backend, "what changes here?" — and to re-verify the already-shipped trend endpoints at the new `N=6` value the web client will now send.

## Context

Both trend endpoints already exist and already accept an arbitrary `months` value (spec 15, `context/specs/15-spending-and-mileage-trend-endpoints.md`):

- `GET /bikes/:bikeId/spending-summary/trend?months=N` — `spending.service.ts:122-145` (`getSpendingTrendFromDB`), validated `1–24` inline in `spending.controller.ts`, default `3` when the query param is omitted.
- `GET /bikes/:bikeId/mileage/trend?months=N` — `mileageRecord.service.ts:219-236` (`getMileageTrendFromDB`), same `1–24` validation/default in `mileageRecord.controller.ts`.

`6` is already inside the validated `1–24` range on both endpoints, and the rolling-window loop (`for (let i = months - 1; i >= 0; i--) { ... }`) has no hardcoded assumption about `months` being `3` — it works unchanged for any value in range. **No service/controller/route code needs to change.**

One unrelated hardcoded caller exists: `src/app/modules/ai/ai.service.ts:105` calls `mileageRecordServices.getMileageTrendFromDB(bikeId, 3)` with a literal `3` to feed a "last 3 months" trend summary into an AI insight prompt. This is a separate feature (AI context, not a client-facing chart) and is explicitly **out of scope** for this spec — leave it unchanged.

## Design

Two small decisions, both leaning toward "do nothing" beyond re-verification:

1. **Should the server-side default (when `months` is omitted) change from 3 to 6?** No. Every current caller — the web client, the (soon-to-be-removed) mobile app charts, and `ai.service.ts` — already passes an explicit literal value rather than omitting the param. Changing the shared default wouldn't affect any of them and would just be an unrequested, un-verified behavior change for any future caller that omits it. Leave the default at `3`.
2. **Should the Postman collection's example requests be updated?** Optional/cosmetic — the "Spending Trend" and "Mileage Trend" requests in `postman/bikelog-api.postman_collection.json` currently show `?months=3` as their example query value. Updating this to `?months=6` keeps the collection's examples aligned with what the web client actually sends now, but has no effect on endpoint behavior. Do it while re-verifying, since it's a one-line JSON edit already open in the same file.

No changes to `spending.service.ts`, `spending.controller.ts`, `spending.route.ts`, `mileageRecord.service.ts`, `mileageRecord.controller.ts`, or `mileageRecord.route.ts`.

## Implementation

1. [ ] Read `spending.service.ts:122-145` and `mileageRecord.service.ts:219-236` to reconfirm the `1–24` bound and the loop logic have no `months === 3`-specific assumption (expected: confirm no change needed, per Design above).
2. [ ] Optionally update the "Spending Trend" and "Mileage Trend" example requests in `postman/bikelog-api.postman_collection.json` from `months=3` to `months=6` in their query params, to match the web client's new default usage.
3. [ ] Leave `ai.service.ts:105`'s hardcoded `getMileageTrendFromDB(bikeId, 3)` untouched — confirm in this spec's Verify section that it was deliberately left alone, not missed.
4. [ ] Re-verify both endpoints live at `months=6` (see Verify below).

## Dependencies

None — this spec only re-verifies already-shipped spec 15 behavior at a new `N` value; no other spec blocks it.

## Verify

- [ ] `GET /bikes/:bikeId/spending-summary/trend?months=6` returns exactly 6 `monthlySummary` entries, ending at the current month, rolling correctly across a year boundary.
- [ ] `GET /bikes/:bikeId/mileage/trend?months=6` returns exactly 6 `monthlySummary` entries, same rolling-window correctness check.
- [ ] Omitting `months` on both endpoints still defaults to `3` (no regression to existing default-consumer behavior).
- [ ] `months=25` and `months=0` still return `400` on both endpoints (bound unchanged by this spec).
- [ ] `yarn build` / `yarn lint` clean (expected: no diff at all outside the optional Postman JSON edit, so this should be a no-op check).
