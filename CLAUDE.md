# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

For product requirements, data model, and API surface, read `context/specs/bike-log-plan.md` first — it's the spec this backend is being built against. For deeper architecture/workflow detail than fits here, see `context/architecture.md`, `context/code-standards.md`, `context/ai-workflow-rules.md`, and `context/progress-tracker.md` (read in that order per `AGENTS.md`).

## Current state

The MVP backend is functionally complete. All 8 modules under `src/app/modules/` (`bike`, `fuelLog`, `mileageRecord`, `maintenanceType`, `engineOilType`, `maintenanceLog`, `spending`, `user`) have real business logic implemented across specs 01–09 — no controller/service returns `501` anymore. `package.json` still says `l2-boiler` — cosmetic leftover, harmless.

Real business-logic work is tracked as numbered specs under `context/specs/`: `01` through `09` are all Complete. **`context/progress-tracker.md` is the single source of truth for exactly which spec/module is implemented vs. stub vs. proposed at any given moment** — check it before assuming a module's logic exists, and check its "Recent Activity"/"Known Gaps" sections for post-implementation bug-fix passes (e.g. an IDOR in the `fuelLog`/`maintenanceLog` list endpoints and a password-leak in registration were both found and fixed in a later audit pass, not caught during the original spec implementation).

## Commands

Run from this directory:

```bash
yarn dev          # ts-node-dev, auto-restart (src/server.ts)
yarn build        # tsc -> dist/
yarn start:prod   # node dist/server.js (after build)
yarn lint         # eslint src
yarn lint:fix
yarn prettier:fix # prettier --write src
```

No real test suite (`yarn test` is a stub). Requires a `.env` with `DATABASE_URL`, `PORT`, `JWT_ACCESS_SECRET` (see `src/app/config/index.ts`).

## Architecture at a glance

- **Module-per-feature** under `src/app/modules/<domain>/`: `.route.ts` / `.controller.ts` / `.service.ts` / `.model.ts` / `.interface.ts` / `.validation.ts`. New modules register in `src/app/router/index.ts`'s `routeArray`. Nested-resource modules (`fuelLog`, `mileageRecord`, `maintenanceLog`, `spending`) use `Router({ mergeParams: true })` since they're mounted under `/bikes/:bikeId/...`; `maintenanceLog.route.ts` uniquely exports **two** routers from one module (CRUD at `/maintenance-logs`, a separate one at `/reminders`).
- **Auth**: JWT bearer via `authCheck` (no roles enforced yet — a `userRole` field exists and is being added to the JWT payload per spec 02, purely as forward-compatible scaffolding for admin features planned in a later version; nothing reads it today). Authorization is ownership-based (`Bike.owner` against `req.user.userId`), meant to be checked in the service layer — `authCheck` itself only verifies the token, it does not check ownership. Passwords hashed with **`argon2`**, not `bcrypt` (both are listed as deps, but `argon2` is what's wired up).
- **Errors/responses**: throw `AppError(status, message)`, let `globalErrorHandler` format it; controllers use `catchAsync` + `sendResponse(res, { status, success, message, data })` — note the key is `status`, not `statusCode`.
- **Soft delete**: `isDeleted` + `pre("find")`/`pre("findOne")` hooks on user-owned records (`bike`, `fuelLog`, `maintenanceLog`). Shared catalogs (`maintenanceType`, `engineOilType`) and derived data (`mileageRecord`) deliberately skip soft delete.
- **Aggregation convention (important, non-default)**: monthly/yearly/lifetime mileage and spending stats are computed via plain Mongoose `.find()` over a date range plus JS `filter()`/`reduce()` — never Mongo `$group` pipelines. This is a deliberate house-style choice (documented in `context/architecture.md`), not an oversight. Averages are computed **client-side** (API returns totals only, never a precomputed average).
- **Event date vs. `createdAt`**: `FuelLog.date` / `MaintenanceLog.serviceDate` are user-editable and are what aggregations must bucket by — entries get back-logged, so `createdAt` would misfile them into the wrong month.
- **Deployment**: Vercel serverless (`vercel.json` → `dist/server.js`). Cache the Mongoose connection across invocations; reminders are computed on-read, not via background cron (a later Vercel Cron Job is planned for push notifications, not yet built).

Full detail (including per-module design decisions not yet implemented) lives in `context/architecture.md` and the numbered specs under `context/specs/`.
