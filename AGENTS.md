> **Stack**: Express + TypeScript + **Prisma 7 + PostgreSQL (Neon)**. The MongoDB/Mongoose migration is complete and merged (PR #20). Gotchas below were corrected for Prisma on 2026-10-01; `context/architecture.md` and `context/code-standards.md` have not been swept and still read Mongoose in places.

## Context first

Read in order before implementing:

1. `context/project-overview.md` — product, scope, MVP/Phase-2
2. `context/architecture.md` — structure, storage, invariants
3. `context/code-standards.md` — conventions
4. `context/ai-workflow-rules.md` — workflow, scoping, delivery
5. `context/progress-tracker.md` — current state, open questions

Update `context/progress-tracker.md` after each meaningful change. If a change affects architecture, scope, or standards, update the relevant context file before continuing.

Feature work follows numbered specs under `context/specs/` — see `context/specs/00-build-plan.md`.

## Commands

| Command                       | What it does                                |
| ----------------------------- | ------------------------------------------- |
| `yarn dev`                    | ts-node-dev, auto-restart (`src/server.ts`) |
| `yarn build`                  | `tsc` → `dist/`                             |
| `yarn lint` / `yarn lint:fix` | ESLint `src/`                               |
| `yarn prettier:fix`           | Prettier `src/`                             |
| `yarn start:prod`             | `node dist/server.js` (after build)         |
| `yarn db:migrate`             | `prisma migrate deploy` (needs `DATABASE_URL_UNPOOLED`) |
| `yarn test`                   | **Stub** — no test suite exists             |

## Verification checklist

- `yarn build` succeeds
- `yarn lint` clean (no new errors)
- Manually verify new/changed endpoints
- For owner-scoped resources, confirm service checks ownership against `req.user.userId`

## Architecture gotchas

- **Response envelope**: `sendResponse(res, { status, success, message, data })` — key is `status`, **not** `statusCode`
- **Errors**: `throw new AppError(httpStatus.<CODE>, "message")` — never `res.status(...).json(...)` from services
- **Password hashing**: `argon2`, **not** `bcrypt` (both in deps; bcrypt is unused boilerplate leftover)
- **Aggregation**: JS `filter()`/`reduce()` over `findMany()` results, **never** SQL/Prisma `groupBy` aggregates
- **Averages**: computed **client-side** — API returns totals only
- **Date bucketing**: group by user-editable event-date fields (`FuelLog.date`, `MaintenanceLog.serviceDate`), **not** `createdAt`
- **Nested resources**: `fuelLog`, `mileageRecord`, `maintenanceLog`, `spending`, `bikeIssue`, `bikeAccessory`, `ai`, `bikeManual`, `bikeDocument` mount under `/bikes/:bikeId/...` — their routers use `Router({ mergeParams: true })`
- **Two routers, one module**: `maintenanceLog.route.ts` exports both `maintenanceLogRouter` (CRUD) and `reminderRouter` (`/reminders`); `errorLog.route.ts` likewise exports `errorLogRouter` (`/admin/error-logs`) and `errorLogCronRouter` (`/cron`)
- **Cron routes skip `authCheck` deliberately** — `/api/cron/*` is gated on an `x-cron-secret` header matched against `CRON_SECRET`, driven by GitHub Actions
- **Soft delete is explicit now**: Prisma has no `pre("find")` hook equivalent — **every** query against `user`/`bike`/`fuelLog`/`maintenanceLog`/`bikeIssue`/`bikeAccessory` must pass `isDeleted: false` in its own `where`. Omitting it leaks deleted rows
- **Duplicate keys**: caught per-service as `Prisma.PrismaClientKnownRequestError` + `code === "P2002"` → 409 `AppError` (`maintenanceType`, `engineOilType`, `user`). `globalErrorHandler`'s Mongo-era `11000`/`CastError`/`ValidationError` branches are **dead** and `P2003`/`P2025` fall through to a generic 500 — catch those locally if they matter
- **Unused deps** (don't import): `bcrypt`, `nodemailer`. `cloudinary`/`multer`/`multer-storage-cloudinary` (uploads), `openai` (via `openRouterClient.ts`) and `argon2` are all **live**
- **Dead code** (don't import): `builder/Queryuilder.ts` — the old Mongoose query builder, replaced by `builder/buildPrismaListQuery.ts`; and `helper/openRouter.ts`, replaced by `util/openRouterClient.ts`
- **Ids are app-generated**: every model is `id String @id` with no `@default` — call `generateObjectId()` on create (Mongo-format 24-char hex, preserved through the migration). Services map rows back to the Mongo-shaped wire contract (`id`→`_id`, FK columns→`bike`/`maintenanceType`/`oilType`, `Decimal`→`Number`), which is why the clients needed no changes
- **Pre-existing lint errors**: ~5 errors + 1 warning in `app.ts`, `Queryuilder.ts`, `interface/index.d.ts`, `globalErrorHandler.ts`, `openRouterClient.ts` — predate Bike Log work; ignore unless cleaning up (clean lint means no *new* errors)
