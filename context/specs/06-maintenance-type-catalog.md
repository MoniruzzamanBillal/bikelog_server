# Maintenance-Type Catalog

## Goal

Implement the two real endpoints for `maintenanceType` (`create` + `list` only — no `:id`/PATCH/DELETE exist in the route, confirmed in spec 01's scaffolding). This is a small shared catalog, not user-owned data, so there's no ownership scoping here.

## Design

- `createMaintenanceTypeIntoDB(payload)`: `MaintenanceTypeModel.create(payload)`. `name` has a `unique` index at the schema level — catch the Mongo duplicate-key error (code `11000`) and rethrow as `AppError(httpStatus.CONFLICT, "A maintenance type with this name already exists")` rather than letting the raw Mongo error reach `globalErrorHandler` as a generic 500 (check how `globalErrorHandler` currently handles duplicate-key errors — if it already normalizes this codebase-wide, this step may be redundant; confirm during implementation rather than assuming).
- `getMaintenanceTypesFromDB()`: plain `.find()`, no filters — this list stays small (under a dozen entries), no pagination needed.
- No auth/role gating beyond the existing `authCheck` on both routes — this codebase has no enforced admin role anywhere (`UserRole` exists as a field but nothing checks it), so any logged-in user can add a maintenance type. Acceptable for a personal/small-multi-user app; flagged here in case that changes later.

**Seed data proposal (addresses the "no seed data" gap logged in `progress-tracker.md`):**
A one-time script, `src/scripts/seedMaintenanceTypes.ts`, run manually via `ts-node src/scripts/seedMaintenanceTypes.ts` (not auto-executed on server start), inserting the 8 categories from `bike-log-plan.md` §4 if they don't already exist (checks by `name` first, skips duplicates rather than erroring):

| name             | defaultIntervalKm                                                            | defaultIntervalDays |
| ---------------- | ---------------------------------------------------------------------------- | ------------------- |
| Engine Oil       | null (interval fully driven by `EngineOilType`/`intervalKmUsed` per spec 08) | null                |
| Chain Lube       | 500                                                                          | null                |
| Tire Change      | null                                                                         | null                |
| Brake Pads       | null                                                                         | null                |
| General Service  | 3000                                                                         | null                |
| Insurance        | null                                                                         | 365                 |
| Registration/Tax | null                                                                         | 365                 |
| Other            | null                                                                         | null                |

The `defaultIntervalKm`/`Days` values above (Chain Lube 500km, General Service 3000km, Insurance/Registration 365 days) are **assumptions, not values from the plan doc** — flagged explicitly for you to adjust or confirm; they're only ever used as a form pre-fill default, never enforced.

## Implementation

1. `maintenanceType.service.ts`: implement `createMaintenanceTypeIntoDB` (with duplicate-key handling) and `getMaintenanceTypesFromDB`.
2. `maintenanceType.controller.ts`: wire real handlers.
3. Add `src/scripts/seedMaintenanceTypes.ts` (standalone script — connects to DB via the same connection logic as `server.ts`, runs the upsert-by-name loop, disconnects, exits). Add a `yarn seed:maintenance-types` script entry to `package.json` for convenience.

## Dependencies

Spec 02 only (needs `authCheck`/auth working; no bike/user-ownership concerns here).

## Verify-when-done

- [ ] `yarn build` / `yarn lint` clean.
- [ ] Creating a duplicate `name` returns 409 with a clear message, not a raw Mongo error.
- [ ] Running the seed script twice doesn't create duplicate entries (idempotent).
- [ ] `GET /maintenance-types` reflects newly created/seeded types immediately.
