# Bike Issue List Sort Order

## Goal

Change `GET /bikes/:bikeId/issues` so `status: "open"` issues always appear before `status: "resolved"` ones, regardless of `dateReported` or creation order — a rider currently has to scan past resolved issues to find what's still outstanding, which defeats the point of a running issue log for a bike that hasn't been to a shop yet.

This is a targeted ordering fix on top of the already-shipped spec 10 module, not a new endpoint or new client-facing field — the two endpoints affected already exist; only the sort behavior of the list endpoint (and, incidentally, one existing status-mutation bug) changes.

## Design

**Ownership and scoping are unchanged.** `getBikeIssuesFromDB` keeps its existing `findOwnedBikeOrThrow` call and the `bike`/`isDeleted` query-stripping IDOR guard from spec 10 exactly as-is.

**Why not sort in memory after fetch.** `getBikeIssuesFromDB` already applies `.pagination()` (`.skip().limit()`) at the DB-query level before the results are returned. If status ordering were applied via a JS `.sort()` after `await issuesQuery.queryModel`, it would only reorder whatever page Mongo already sliced out — correct on page 1 only by coincidence, wrong the moment a bike has more open+resolved issues than the page size. The ordering has to happen inside the Mongo query itself, before `.skip()`/`.limit()` run.

**Why not an aggregation pipeline either.** An `$addFields` + `$switch` + `$sort` pipeline could compute the rank inline without a persisted field, but `Queryuilder` only ever wraps `Query<T[], T>`, never `Aggregate<T[]>` (confirmed: `grep -rn "\.aggregate(" src` returns nothing repo-wide), and `code-standards.md` explicitly warns `.aggregate()` bypasses the soft-delete `pre("find")` hooks, requiring `isDeleted: false` to be re-added to `$match` by hand. Introducing the first `.aggregate()` call in the codebase just for this would also cut against the documented house-style preference (`architecture.md` invariant 6) for plain `.find()`-based approaches. A materialized field is the simpler, more idiomatic fit here.

**Materialized `statusRank`, kept in sync by a `pre("save")` hook.** Add a persisted `statusRank: number` field to the schema, computed as `Object.values(BikeIssueStatus).indexOf(this.status)` — `open` → `0`, `resolved` → `1`, using the enum's own declared order as the single source of truth rather than a separately hardcoded rank map. Recompute it unconditionally on every save inside a `bikeIssueSchema.pre("save")` hook (precedent: `user.model.ts` already has a `pre("save")` hook for password hashing). Unlike the password hook, there's no need for an `isModified` guard — recomputing an `indexOf` lookup every save is cheap, and this keeps the field correct even on unrelated field updates. `Model.create()` internally calls `.save()` on each document, so this also covers issue creation with no extra code at the call site.

**Compound sort string, no `Queryuilder.ts` change.** `Queryuilder.sort(sortBy)` passes its argument straight to Mongoose's own `Query.prototype.sort(string)`, which natively parses space-separated compound sort strings (`-` prefix = descending). `getBikeIssuesFromDB` already hardcodes `.sort("-dateReported")` — change it to `.sort("statusRank -dateReported")`. Since this call was already a bare literal (this endpoint never honored a client `?sort=` to begin with), this is a direct one-line swap with no behavior change beyond adding the new primary key.

**`updateBikeIssueStatus` must go through `.save()`, not `findByIdAndUpdate`.** `bikeIssue.service.ts`'s `updateBikeIssueStatus` currently calls `bikeIssueModel.findByIdAndUpdate(issue.id, { status }, { new: true, runValidators: true })` — Mongoose does not run document middleware (including `pre("save")`) for `findByIdAndUpdate`, so `statusRank` would go stale the moment an issue's status is flipped via this endpoint, the most common way status actually changes. The function already fetches `issue` earlier in the same body for its "already this status" 400 check, so the fix is to drop the `findByIdAndUpdate` call entirely and instead do `issue.status = status; await issue.save(); return issue;` — this also brings the function in line with every other mutator in the module (`updateBikeIssueInDB`, `deleteBikeIssueFromDB` already follow fetch-then-mutate-then-`.save()`).

**Defensive stripping.** `statusRank` must never be client-settable. `updateBikeIssueInDB` already does `delete updateData.status` before `Object.assign` — add `delete updateData.statusRank` alongside it. **`bikeIssue.validation.ts`'s Zod schemas must NOT gain a `statusRank` field** in any create/update/status schema — this is a deliberate omission, not an oversight, since the field must only ever be server-derived.

**Response shape.** `statusRank` will appear in every list/get-by-id response the same way `isDeleted` already does today (the `field()` builder's default select is only `-__v`) — this is a conscious choice to match existing house style (no field is ever hidden via `select: false` anywhere in the codebase) rather than an oversight to fix.

**Migration note for already-existing documents.** The `pre("save")` hook only runs on writes. Any `BikeIssue` document already persisted before this ships keeps the schema `default: 0` for `statusRank` until it's next saved (e.g. via a status flip or generic update) — a pre-existing resolved issue could rank alongside opens until touched once. Given the codebase's existing precedent for one-off scripts (`src/scripts/seedMaintenanceTypes.ts`, run via `ts-node --transpile-only`), an optional `src/scripts/backfillBikeIssueStatusRank.ts` that iterates `bikeIssueModel.find()` and calls `.save()` on each document is the lightweight, in-house-style way to close this gap before deployment; the alternative (accept the field is correct only for anything created/touched from this point forward) is fine for early-stage/dev data but should be an explicit decision, not silent.

## Implementation

1. `bikeIssue.interface.ts`: add `statusRank: number` to `TBikeIssue`.
2. `bikeIssue.model.ts`: add schema field `statusRank: { type: Number, default: 0 }`; add a `pre("save")` hook setting `this.statusRank = Object.values(BikeIssueStatus).indexOf(this.status)`.
3. `bikeIssue.service.ts`: change `getBikeIssuesFromDB`'s `.sort("-dateReported")` to `.sort("statusRank -dateReported")`; rewrite `updateBikeIssueStatus` to `issue.status = status; await issue.save(); return issue;` instead of `findByIdAndUpdate`; add `delete updateData.statusRank` in `updateBikeIssueInDB` alongside the existing `delete updateData.status`.
4. `bikeIssue.validation.ts`: no changes — confirm `statusRank` is intentionally absent from every Zod schema.
5. (Optional) `src/scripts/backfillBikeIssueStatusRank.ts`: one-off re-save script for pre-existing documents, mirroring the shape of `seedMaintenanceTypes.ts`; add a corresponding `package.json` script entry if written.

## Dependencies

Spec 10 (the `bikeIssue` module itself must already exist — it does, per `progress-tracker.md`). No dependency on spec 13 — the two modules are independent and can be implemented/verified in either order.

## Verify-when-done

- [ ] `yarn build` / `yarn lint` clean.
- [ ] `GET /bikes/:bikeId/issues` returns all `open` issues before all `resolved` issues, regardless of `dateReported` order (create fixtures with a resolved issue reported before an open one and confirm the open one still lists first).
- [ ] Within each status group, `dateReported` descending order is preserved (the secondary sort key still works).
- [ ] `PATCH /:id/status` flipping `open` → `resolved` → `open` correctly re-sorts the issue in a subsequent list call each time — confirms the switch from `findByIdAndUpdate` to `.save()` actually re-triggers the `pre("save")` hook rather than leaving `statusRank` stale.
- [ ] `PATCH /:id/status` on an already-matching status still 400s exactly as before — behavior unchanged by the `.save()` refactor.
- [ ] `PATCH /:id` (generic update) with a spoofed `statusRank` in the body has zero effect on the persisted value.
- [ ] Pagination across multiple pages (e.g. `?limit=1`) reflects one continuous open-before-resolved order across pages, not just within a single page — confirms the sort happens at the DB-query level, not an in-memory reorder of a single page.
- [ ] `GET /bikes/:bikeId/issues?bike=<anotherBikesId>` still never leaks another bike's issues (existing IDOR protection unaffected by this change).
- [ ] Issues for bike A still never appear in bike B's list, even for the same authenticated user.
