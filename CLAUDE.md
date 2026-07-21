# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

For product requirements, data model, and API surface, read `context/specs/bike-log-plan.md` first — it's the spec this backend is being built against. For deeper architecture/workflow detail than fits here, see `context/architecture.md`, `context/code-standards.md`, `context/ai-workflow-rules.md`, and `context/progress-tracker.md` (read in that order per `AGENTS.md`).

## Current state

The MVP backend is functionally complete, plus two post-MVP modules. 10 modules under `src/app/modules/` have real business logic: the original 8 (`bike`, `fuelLog`, `mileageRecord`, `maintenanceType`, `engineOilType`, `maintenanceLog`, `spending`, `user`, specs 01–09), `bikeIssue` (spec 10, issue tracking with a simple `open`/`resolved` status at `/bikes/:bikeId/issues` — no history/recurrence tracking, see `progress-tracker.md`'s 2026-07-21 entry for why that was simplified out), and `bikeAccessory` (spec 11, a per-bike purchase wishlist with `urgency`/`status` at `/bikes/:bikeId/accessories`, plain CRUD with no state machine) — no controller/service returns `501` anymore. `package.json` still says `l2-boiler` — cosmetic leftover, harmless.

**`context/progress-tracker.md` is the single source of truth for exactly which spec/module is implemented vs. stub vs. proposed at any given moment** — check it before assuming a module's logic exists, and check its "Recent Activity"/"Known Gaps" sections for post-implementation bug-fix passes (e.g. an IDOR in the `fuelLog`/`maintenanceLog` list endpoints and a password-leak in registration were both found and fixed in a later audit pass, not caught during the original spec implementation; `bikeIssue`/`bikeAccessory`'s list endpoints were written with the IDOR-safe query-stripping pattern from the start).

## Commands

Run from this directory:

```bash
yarn dev                       # ts-node-dev, auto-restart (src/server.ts)
yarn build                     # tsc -> dist/
yarn start:prod                # node dist/server.js (after build)
yarn lint                      # eslint src
yarn lint:fix
yarn prettier:fix              # prettier --write src
yarn seed:maintenance-types    # idempotent upsert of 8 plan-defined maintenance types
yarn seed:engine-oil-types     # idempotent upsert of 3 oil types
```

No real test suite (`yarn test` is a stub that exits 1). "Verification" for a change means `yarn build` + clean `yarn lint`, plus manual verification of the affected endpoint — the `postman/bikelog-api.postman_collection.json` collection (with `postman/dummy-data.md` for sample payloads) is the manual-testing tool of record, not curl one-offs from scratch. Requires a `.env` with `DATABASE_URL`, `PORT`, `JWT_ACCESS_SECRET`, optionally `JWT_EXPIRES_IN` (defaults `"10d"`) — see `src/app/config/index.ts`.

## Architecture at a glance

- **Module-per-feature** under `src/app/modules/<domain>/`: `.route.ts` / `.controller.ts` / `.service.ts` / `.model.ts` / `.interface.ts` / `.validation.ts` (`.constant.ts` where an `as const` enum is needed, e.g. `bikeIssue`, `bikeAccessory`). New modules register in `src/app/router/index.ts`'s `routeArray`. Nested-resource modules (`fuelLog`, `mileageRecord`, `maintenanceLog`, `spending`, `bikeIssue`, `bikeAccessory`) use `Router({ mergeParams: true })` since they're mounted under `/bikes/:bikeId/...`; `maintenanceLog.route.ts` uniquely exports **two** routers from one module (CRUD at `/maintenance-logs`, a separate one at `/reminders`).
- **Auth**: JWT bearer via `authCheck` (no roles enforced yet — a `userRole` field exists and is added to the JWT payload per spec 02, purely as forward-compatible scaffolding for admin features planned in a later version; nothing reads it today). Authorization is ownership-based (`Bike.owner` against `req.user.userId`), checked in the service layer via a shared `findOwnedBikeOrThrow` helper (`bike.utils.ts`) — `authCheck` itself only verifies the token, it does not check ownership. Passwords hashed with **`argon2`**, not `bcrypt` (both are listed as deps, but `argon2` is what's wired up in `user.model.ts`'s `pre("save")` hook).
- **Errors/responses**: throw `AppError(status, message)`, let `globalErrorHandler` format it; controllers use `catchAsync` + `sendResponse(res, { status, success, message, data })` — note the key is `status`, not `statusCode`.
- **List filtering IDOR pattern**: any list endpoint nested under `/bikes/:bikeId/...` must strip `bike`/`isDeleted` out of `req.query` before handing it to `Queryuilder.filter()` — that class's `.filter()` runs a second `.find(queryObj)` on top of the already ownership-scoped `.find({ bike: bikeId, isDeleted: false })`, and Mongoose merges conflicting keys last-write-wins, so an unsanitized `?bike=<otherBikeId>` can leak another user's data. This bit `fuelLog`/`maintenanceLog` in a later audit pass; `bikeIssue` and `bikeAccessory` both build the pattern in from the start. Apply it to any new nested-list endpoint.
- **Soft delete**: `isDeleted` + `pre("find")`/`pre("findOne")` hooks on user-owned records (`bike`, `fuelLog`, `maintenanceLog`, `bikeIssue`, `bikeAccessory`). Shared catalogs (`maintenanceType`, `engineOilType`) and derived data (`mileageRecord`) deliberately skip soft delete. `.aggregate()` bypasses these hooks — add `isDeleted: false` to `$match` manually if one is ever introduced.
- **Aggregation convention (important, non-default)**: monthly/yearly/lifetime mileage and spending stats are computed via plain Mongoose `.find()` over a date range plus JS `filter()`/`reduce()` — never Mongo `$group` pipelines. This is a deliberate house-style choice (documented in `context/architecture.md`), not an oversight. Averages are computed **client-side** (API returns totals only, never a precomputed average).
- **Event date vs. `createdAt`**: `FuelLog.date` / `MaintenanceLog.serviceDate` are user-editable and are what aggregations must bucket by — entries get back-logged, so `createdAt` would misfile them into the wrong month.
- **`Bike.initialOdometer` vs. `currentOdometer`**: `initialOdometer` is an immutable snapshot taken at bike creation; `currentOdometer` is denormalized and only ever bumped upward via `bumpOdometerIfHigher` (`bike.utils.ts`). Anchor "the bike's starting point" math on `initialOdometer`, never `currentOdometer` — the latter may already have been mutated by the very log being processed (a real bug fixed post-implementation; see `progress-tracker.md`'s spec 03–05 review).
- **`src/app/builder/Queryuilder.ts`** (the class is `Queryuilder`, not `QueryBuilder` — a real filename/class-name typo, not a display quirk; grep for `Queryuilder` when searching for it).
- **`dist/` is checked into git but goes stale** — it's not regenerated automatically and still contains modules (`boilerModule`, `transaction`) that were deleted from `src/` back in spec 01. Never treat `dist/` as source of truth for what modules exist; run `yarn build` if you need it current.
- **Unused boilerplate deps** — don't build on these: `bcrypt`, `cloudinary`, `multer`, `multer-storage-cloudinary`, `nodemailer`, `openai`. `src/app/helper/openRouter.ts` and `src/app/util/openRouterClient.ts` are the same kind of leftover.
- **Deployment**: Vercel serverless (`vercel.json` → `dist/server.js`). Cache the Mongoose connection across invocations; reminders are computed on-read, not via background cron (a later Vercel Cron Job is planned for push notifications, not yet built).

Full detail (including per-module design decisions not yet implemented) lives in `context/architecture.md`, `context/code-standards.md`, and the numbered specs under `context/specs/`.
