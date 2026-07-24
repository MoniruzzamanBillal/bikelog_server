# Bike Issue List Sort Order

## Goal

`GET /bikes/:bikeId/issues` must list `status: "open"` issues before all `status: "resolved"` ones, regardless of `dateReported` or creation order.

## Design (revised — supersedes the original `statusRank` approach)

**Original approach and why it was reverted.** The first implementation of this spec (2026-07-22) added a persisted `statusRank: number` field to `BikeIssue`, kept in sync via a `pre("save")` hook, and sorted with `.sort("statusRank -dateReported")`. This worked for any issue created or saved after the fix shipped, but the hook only runs on write — every issue already in the database at that point kept `statusRank` at its schema default (`0`) regardless of actual status, since nothing had touched it since. Both `open` and `resolved` legacy issues ranked identically, so the sort silently fell back to `-dateReported`, which read as plain creation order. The spec at the time flagged this exact gap and proposed an optional backfill script to re-save every document once. That script was never written, and a follow-up request explicitly rejected a migration/backfill approach in favor of a fix that works correctly on existing data with no migration step at all.

**Revised approach: sort directly on the existing `status` field, no derived field.** `BikeIssueStatus` is `{ open: "open", resolved: "resolved" }`. Mongo/Mongoose sorts strings lexicographically by default, and `"open" < "resolved"` alphabetically — so `.sort("status -dateReported")` (ascending on `status`, descending on `dateReported` as the secondary key) already produces exactly "open before resolved" for every document, past and future, with no persisted rank field, no `pre("save")` hook, and no migration risk. This is strictly simpler than the original design and has no known gaps.

**Tradeoff accepted.** This relies on the coincidence that the two enum values already sort alphabetically in the desired order. If a third status value were ever added whose alphabetical position didn't match the desired display order, this would need revisiting (e.g. back to a rank-based approach) — but with exactly two statuses today, introducing that complexity now would be solving a problem that doesn't exist yet.

**Ownership and scoping are unchanged.** `getBikeIssuesFromDB` keeps its existing `findOwnedBikeOrThrow` call and the `bike`/`isDeleted` query-stripping IDOR guard from spec 10 exactly as-is.

**Why not sort in memory after fetch.** Same reasoning as the original spec: `.pagination()` (`.skip().limit()`) runs at the DB-query level, so any sort has to happen inside the Mongo query itself, before `.skip()`/`.limit()` — a JS `.sort()` after fetch would only reorder within a single already-sliced page.

## Implementation

1. `bikeIssue.service.ts`: change `getBikeIssuesFromDB`'s `.sort("statusRank -dateReported")` to `.sort("status -dateReported")`.
2. `bikeIssue.model.ts`: remove the `statusRank` schema field and its `pre("save")` hook (dead code now that sorting no longer depends on it).
3. `bikeIssue.interface.ts`: remove `statusRank: number` from `TBikeIssue`.
4. `bikeIssue.service.ts`: remove the now-unneeded `delete updateData.statusRank` line in `updateBikeIssueInDB`.
5. `bikeIssue.validation.ts`: no changes (never referenced `statusRank`).
6. No backfill script — not needed; this sort works correctly on already-existing documents immediately.

## Dependencies

Spec 10 (the `bikeIssue` module itself). Supersedes the `statusRank`-based portion of this spec's original implementation; no dependency on spec 13.

## Verify-when-done

- [ ] `yarn build` / `yarn lint` clean.
- [ ] `GET /bikes/:bikeId/issues` returns all `open` issues before all `resolved` issues on **existing** dev data (created before this fix), with no script run — proves there's no migration gap.
- [ ] Within each status group, `dateReported` descending order is preserved.
- [ ] `PATCH /:id/status` flipping `open` → `resolved` → `open` correctly re-sorts the issue in a subsequent list call.
- [ ] `PATCH /:id/status` on an already-matching status still 400s exactly as before.
- [ ] Pagination (`?limit=1` across multiple pages) reflects one continuous open-before-resolved order across pages, not a per-page reorder.
- [ ] `GET /bikes/:bikeId/issues?bike=<anotherBikesId>` still never leaks another bike's issues.
- [ ] Issues for bike A still never appear in bike B's list, even for the same authenticated user.
