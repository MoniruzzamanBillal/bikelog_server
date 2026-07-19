# Architecture

## Stack

| Layer | Technology | Role |
| --- | --- | --- |
| **Runtime/Framework** | Node.js + Express 4 | HTTP server and routing. |
| **Language** | TypeScript | Static typing across routes/services/models. |
| **Database** | MongoDB via Mongoose | Persistence for all domain models. |
| **Auth** | `jsonwebtoken` | Access-token issuance/verification (`config.jwt_secret`). Password hashing via `argon2` (see `code-standards.md`). |
| **Validation** | Zod | Request-body schema validation via `validateRequest`. |
| **Deployment** | Vercel serverless (`@vercel/node`) | See Deployment Notes below. |

No file upload, payment, or email dependencies are needed for Bike Log — `cloudinary`, `multer`, `nodemailer`, and `openai` are present in `package.json` only because this project was cloned from another boilerplate; they are not part of Bike Log's design and shouldn't be treated as available conventions unless a future feature actually needs them.

## System Boundaries

- `src/server.ts` — process entry point: connects Mongoose (`config.database_url`), then starts the HTTP listener.
- `src/app.ts` — Express app composition, in order: `express.json()` → CORS (explicit origin allowlist) → `morgan("dev")` → `cookieParser()` → `MainRouter` mounted at `/api` → root `GET /` health check → `globalErrorHandler` → catch-all 404 handler. This order matters — the error handler must come after routes and before the 404 handler.
- `src/app/router/index.ts` — aggregates every module's router into a `routeArray` (`{ path, route }` pairs) and mounts each under its path prefix, all under the `/api` base from `app.ts`.
- `src/app/modules/<name>/` — one directory per domain resource. **Current state: only `transaction` and `user`, both inherited unmodified from `expense-tracker-server` — neither is Bike Log's actual domain.** Real Bike Log modules (`bike`, `fuelLog`, `mileageRecord`, `maintenanceType`, `maintenanceLog`, and either a renamed or replaced `user`) don't exist yet; see `context/specs/00-build-plan.md` for build order. When added, each module follows this split:
  - `*.route.ts` — Express router; wires middleware (`authCheck`, `validateRequest`) to controller methods.
  - `*.controller.ts` — thin; wraps a service call with `catchAsync` and responds via `sendResponse`.
  - `*.service.ts` — business logic and Mongoose queries.
  - `*.model.ts` — Mongoose schema/model.
  - `*.interface.ts` — TS types for the domain object.
  - `*.validation.ts` — Zod schemas.
  - `*.constant.ts` — enums/constants, where needed.
- `src/app/middleware/` — `authCheck.ts`, `validateRequest.ts`, `globalErrorHandler.ts` (see Middleware below).
- `src/app/util/` — `catchAsync.ts`, `sendResponse.ts`.
- `src/app/Error/` — `AppError.ts` plus `handleZodError.ts` / `handleValidationError.ts` / `handleCatError.ts` (Mongoose `CastError`) / `handleDuplicateError.ts` (Mongo duplicate-key `11000`), consumed by `globalErrorHandler`.
- `src/app/builder/Queryuilder.ts` — generic Mongoose query builder (`search`/`filter`/`sort`/`pagination`/`field`), inherited from the boilerplate; reusable for any future paginated/filterable list endpoint (e.g. fuel-log or maintenance-log history), not yet wired into any Bike Log route.
- `src/app/config/index.ts` — the single place `process.env` is read (`node_env`, `port`, `database_url`, `jwt_secret`, plus a leftover `openRouterApiKey` not used by Bike Log). New code should import `config` rather than reading `process.env` directly.
- `src/app/helper/openRouter.ts` — leftover from the boilerplate (AI/LLM helper); not part of Bike Log's design, don't build on it without a real reason to.

## Middleware

- `authCheck` (`src/app/middleware/authCheck.ts`) — verifies the `Authorization: Bearer <token>` JWT via `config.jwt_secret`, attaches the decoded payload to `req.user`. Takes no role arguments — Bike Log has a single `User` role, so this only ever checks "is there a valid token," never a permission level.
- `validateRequest(schema)` (`src/app/middleware/validateRequest.ts`) — runs `schema.parseAsync({ body: req.body })`, throwing a `ZodError` on failure (normalized by `globalErrorHandler`). Only validates `req.body` — not query params or route params.
- `globalErrorHandler` (`src/app/middleware/globalErrorHandler.ts`) — normalizes `ZodError`, Mongoose `ValidationError`/`CastError`, MongoDB duplicate-key (`code: 11000`), and `AppError` into one JSON error shape (`{ success: false, message, errorSources, stack }`). Falls back to `error.status`/`error.message`/500 for anything unrecognized.

## Auth Model

- Users authenticate via `POST /api/auth/login`, receiving a JWT signed with `config.jwt_secret`.
- Every protected route calls `authCheck` (no role parameter needed — see above).
- Ownership, not roles, gates access: a route handler must confirm the requested `Bike`/`FuelLog`/`MaintenanceLog` actually belongs to `req.user`'s id before returning or mutating it — there's no separate authorization middleware for this yet, so each service function is responsible for that check itself.

## Invariants

1. **Response envelope:** every controller responds via `sendResponse<T>(res, { status, success, message, data, token? })` (note the key is `status`, not `statusCode`) — don't hand-roll `res.json(...)` in new controllers.
2. **Async error propagation:** every controller/middleware handler that can throw is wrapped in `catchAsync` so errors reach `next(error)` and the global handler, rather than crashing the process or being swallowed.
3. **Validation before controller:** any route accepting a body goes through `validateRequest(schema)` before the controller runs.
4. **Config centralization:** all environment variables are read once in `src/app/config/index.ts` and imported from there.
5. **Module self-containment:** a new domain resource gets its own `src/app/modules/<name>/` directory following the file split above, registered in `src/app/router/index.ts`'s `routeArray` — don't bolt unrelated logic onto an existing module.
6. **Aggregation style — JS filter/reduce, not `$group` pipelines.** Date-ranged stats (monthly/yearly/lifetime mileage and spending summaries) must be computed with plain Mongoose `.find()` over a date range plus JS-side `filter()`/`reduce()`, mirroring `expense-tracker-server/src/app/modules/transaction/transaction.service.ts` (`getMonthlyTransactions`, `getYearlySummary`). This is a deliberate house-style choice, not an oversight — don't introduce `$group` aggregation pipelines for these.
7. **Averages computed client-side.** Endpoints return totals (e.g. `totalDistanceKm`, `totalLitersConsumed`); dividing them into an average is the client's job (mirrors `expense-tracker-client`'s `WeeklyAverageCard`), not something the API precomputes.
8. **Event date drives aggregation bucketing, not `createdAt`.** Every loggable entry (`FuelLog.date`, `MaintenanceLog.serviceDate`) is a user-editable "when this happened" field, separate from Mongoose's own `createdAt`. All monthly/yearly/lifetime aggregations must filter/bucket by the event-date field — because entries are sometimes back-logged days after the fact, bucketing by `createdAt` would put them in the wrong month.

## Deployment Notes (Vercel + Express)

`vercel.json` routes all requests to `dist/server.js` as a single serverless function. Two things matter once real endpoints exist:

- Cache the Mongoose connection across invocations (connect once at module scope) — a fresh connection per invocation will exhaust connection limits fast.
- Maintenance reminders must be computed **on read** (comparing `currentOdometer` to `nextDueOdometer` inside the request handler), not via a background cron — serverless functions don't keep a persistent process running. Phase-2 push notifications use a Vercel Cron Job hitting a dedicated route instead.
