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
| `yarn seed:maintenance-types` | Seed 8 maintenance types (idempotent)       |
| `yarn seed:engine-oil-types`  | Seed 3 oil types (idempotent)               |
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
- **Aggregation**: JS `filter()`/`reduce()` over `.find()` results, **never** Mongo `$group` pipelines
- **Averages**: computed **client-side** — API returns totals only
- **Date bucketing**: group by user-editable event-date fields (`FuelLog.date`, `MaintenanceLog.serviceDate`), **not** `createdAt`
- **Nested resources**: `fuelLog`, `mileageRecord`, `maintenanceLog`, `spending` mount under `/bikes/:bikeId/...` — their routers use `Router({ mergeParams: true })`
- **Two routers, one module**: `maintenanceLog.route.ts` exports **both** `maintenanceLogRouter` (CRUD) and `reminderRouter` (`/reminders`)
- **Soft delete**: `isDeleted` + `pre("find")`/`pre("findOne")` hooks on user-owned records — `.aggregate()` bypasses these; add `isDeleted: false` to `$match` manually
- **Duplicate keys**: catalog modules (`maintenanceType`, `engineOilType`) catch code 11000 → 409 `AppError` manually; duplicate **email** on register returns generic 400 (pre-existing gap)
- **Unused deps** (boilerplate leftovers — don't import): `bcrypt`, `cloudinary`, `multer`, `nodemailer`, `openai`
- **Pre-existing lint errors**: ~5 errors + 1 warning in `app.ts`, `Queryuilder.ts`, `interface/index.d.ts`, `globalErrorHandler.ts`, `openRouterClient.ts` — predate Bike Log work; ignore unless cleaning up
