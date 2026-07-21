# Bike Issue Tracking

> **Implementation note (post-hoc correction):** the module as actually built (and reviewed 2026-07-21) is simpler than the design below — there is **no `history` array or `resolvedInMaintenanceLog` field**, and resolve/reopen are **not** separate endpoints. Instead `TBikeIssue` has just `status: "open" | "resolved"`, and a single `PATCH /:id/status` endpoint (body `{ status }`, zod-enum-validated) drives both directions, guarded so setting a status equal to the issue's current status 400s instead of silently no-op'ing. This matches the actual usage pattern: log an issue (starts `open`) → mark it `resolved` once fixed → flip back to `open` if the same problem recurs, with no need to track how many times or via which maintenance visit. The `history`/`resolvedInMaintenanceLog`/dedicated-resolve-and-reopen design below is kept for record but is **not** what's implemented; don't build against it.

## Goal

Add a new `bikeIssue` module so a rider can log a problem noticed while riding (e.g. "brake squeaks") without needing to visit a service center immediately, track it through an `open`/`resolved` lifecycle, and — when the same problem comes back days or weeks after being marked resolved — reopen the _same_ document rather than creating a duplicate, preserving a full history of how many times it has recurred.

This is a deliberate scope expansion beyond the original `bike-log-plan.md` (no prior mention of issue tracking exists there or anywhere in `context/`) — added on direct user request, motivated by a real constraint: the user can't visit the service center on demand (job/other commitments), so issues need to be logged as they're noticed and carried until the next monthly visit, and sometimes a "fixed" issue resurfaces 6-7 days later.

## Design

**Ownership:** every endpoint takes `:bikeId`, calls `findOwnedBikeOrThrow` (spec 03) first, exactly like every other nested resource.

**Status is exactly two values, `open`/`resolved`** (`BikeIssueStatus` in `bikeIssue.constant.ts`, the first real usage of the `as const` enum pattern prescribed by `code-standards.md`). There is no separate "recurring" state — recurrence is inferred by the status flipping back to `open` while `history` is non-empty.

**Recurrence modeled as reopening, not a new document** (confirmed product decision): `history: TBikeIssueHistoryEntry[]` on the same document, each entry `{ resolvedAt, reopenedAt?, resolvedInMaintenanceLog? }`. A resolve pushes a new entry with `resolvedAt` set; a reopen sets `reopenedAt` on the _last_ entry in that array (the still-open-ended most recent resolution). If the issue is resolved again later, a fresh entry is pushed — so the array length is literally the recurrence count.

**`resolvedInMaintenanceLog` — included, but per-history-entry, not top-level.** A single top-level ref would only capture the latest fix and lose which visit fixed which recurrence — since a bike issue can recur and be fixed by a _different_ service visit each time, the ref belongs inside each `history` entry. It's optional and, when supplied, is validated the same way spec 08 validates `maintenanceType`/`oilType`: `maintenanceLogModel.findOne({ _id, bike: bikeId, isDeleted: false })` must exist, else `AppError(404, "Maintenance log not found")`.

**Resolve/reopen are dedicated endpoints (`PATCH /:id/resolve`, `PATCH /:id/reopen`), not a generic `PATCH /:id { status }`.** This project's convention favors thin generic CRUD except where derived data/side effects require bespoke logic — the existing precedent is `maintenanceLog`'s `reminders` sub-router. Resolve/reopen mutate the `history` array and enforce hard state-machine rules (can't resolve an already-resolved issue; can't reopen an already-open one), which is exactly that kind of side-effect logic. Consequently the generic `PATCH /:id` endpoint **strips `status` and `history`** from any payload before applying `Object.assign` — it can only edit `title`/`description`/`dateReported`, never bypass the resolve/reopen state machine.

**CRUD + actions:**

- `createBikeIssueIntoDB`: ownership check → force `status: "open"`, `history: []` regardless of anything the client sends → `dateReported` defaults to now if omitted → save.
- `getBikeIssuesFromDB(bikeId, userId, query)`: ownership check → **strip `bike`/`isDeleted` from `query` before constructing `QueryBuilder`** (the same IDOR fix already applied to `fuelLog`/`maintenanceLog` — `QueryBuilder.filter()`'s `.find(queryObj)` merges with last-write-wins over the ownership-scoped `.find()`, so an unsanitized `?bike=<otherBikeId>` would leak another bike's issues) → `.find({ bike: bikeId, isDeleted: false }).filter().sort("-dateReported").pagination().field()`; `?status=open|resolved` filtering is free via `.filter()`.
- `getBikeIssueByIdFromDB`, `deleteBikeIssueFromDB`: ownership check + scoped `findOne`/soft delete, same shape as every other module.
- `updateBikeIssueInDB`: ownership check, scoped fetch, strip `status`/`history` from the payload, `Object.assign` + `save()`.
- `resolveBikeIssueInDB(bikeId, userId, id, payload)`: ownership check, scoped fetch (404 if missing); `AppError(400, "Issue is already resolved")` if already `resolved`; if `payload.resolvedInMaintenanceLog` given, verify it exists and belongs to this bike; push `{ resolvedAt: new Date(), resolvedInMaintenanceLog }` onto `history`; set `status: "resolved"`; save.
- `reopenBikeIssueInDB(bikeId, userId, id)`: ownership check, scoped fetch (404 if missing); `AppError(400, "Issue is already open")` if already `open`; take the last `history` entry (defensive `AppError(400, ...)` if somehow empty) and set its `reopenedAt = new Date()`; set `status: "open"`; save (call `markModified("history")` first if manual testing shows the nested-array mutation isn't detected by `save()`).

## Implementation

1. `bikeIssue.constant.ts`: `BikeIssueStatus` `as const` object + derived `TBikeIssueStatus` type.
2. `bikeIssue.interface.ts`: `TBikeIssueHistoryEntry`, `TBikeIssue`.
3. `bikeIssue.model.ts`: sub-schema for `history` (`{ _id: false }`), main schema with `enum: Object.values(BikeIssueStatus)`, soft-delete `pre("find")`/`pre("findOne")` hooks.
4. `bikeIssue.validation.ts`: `createBikeIssueSchema`, `updateBikeIssueSchema`, `resolveBikeIssueSchema`, `reopenBikeIssueSchema`.
5. `bikeIssue.service.ts`: all 7 functions per Design above.
6. `bikeIssue.controller.ts`: 7 thin `catchAsync` wrappers using `sendResponse`.
7. `bikeIssue.route.ts`: single `Router({ mergeParams: true })` exported as `bikeIssueRouter`, chain `authCheck` → (`validateRequest` for POST/PATCH) → controller for each of the 7 routes.
8. `src/app/router/index.ts`: import `bikeIssueRouter`, add `{ path: "/bikes/:bikeId/issues", route: bikeIssueRouter }` to `routeArray`.

## Dependencies

Spec 03 (`findOwnedBikeOrThrow`), spec 08 (`MaintenanceLog` model + referential-check pattern, reused for `resolvedInMaintenanceLog` validation). No circular dependency — logically sequenced after both.

## Verify-when-done

- [ ] `yarn build` / `yarn lint` clean.
- [ ] Creating an issue always starts `status: "open"`, `history: []`, regardless of what a client sends for those fields.
- [ ] `PATCH /:id/resolve` on an open issue: `status` becomes `resolved`, `history` gains exactly one entry with `resolvedAt` set and `reopenedAt` absent.
- [ ] `PATCH /:id/resolve` on an already-resolved issue returns 400, not a silent no-op or duplicate history entry.
- [ ] `PATCH /:id/reopen` on a resolved issue: `status` becomes `open`, the _last_ `history` entry's `reopenedAt` is now set (earlier entries untouched).
- [ ] `PATCH /:id/reopen` on an already-open issue returns 400.
- [ ] A second resolve/reopen cycle appends a _second_ `history` entry rather than mutating the first — `history.length` after 2 full cycles is 2.
- [ ] `PATCH /:id` (generic update) with a `status` or `history` field in the body has zero effect on those two fields, even though other fields in the same request still update.
- [ ] Resolving with a `resolvedInMaintenanceLog` id that belongs to a different bike (or doesn't exist) returns 404, not a dangling ref.
- [ ] `GET /bikes/:bikeId/issues?status=open` (and `?status=resolved`) correctly filters.
- [ ] `GET /bikes/:bikeId/issues?bike=<anotherBikesId>` never leaks another bike's issues — response stays scoped to the URL's `:bikeId`.
- [ ] Issues for bike A never appear in bike B's list/get/resolve/reopen/delete, even for the same authenticated user.
