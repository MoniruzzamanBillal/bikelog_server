# Engine-Oil-Type Catalog

## Goal

Implement the two real endpoints for `engineOilType` (`create` + `list` only, same shape as `maintenanceType` in spec 06). This is the reference table `MaintenanceLog.oilType` points at when `maintenanceType` is Engine Oil, purely to pre-fill the form's suggested interval — never enforced.

## Design

- `createEngineOilTypeIntoDB(payload)`: `EngineOilTypeModel.create(payload)`. Same duplicate-`name` → `AppError(409, ...)` handling as spec 06's `maintenanceType`.
- `getEngineOilTypesFromDB()`: plain `.find()`, no pagination (tiny catalog).
- Same no-role-gating rationale as spec 06 — any authenticated user can add an oil type.

**Seed data proposal:**
`bike-log-plan.md` §2.2 only pins one concrete number (Synthetic ≈ 1250km) as an example; Mineral/Semi-Synthetic aren't given specific values. Proposed seed set for `src/scripts/seedEngineOilTypes.ts` (same pattern as spec 06's script — upsert-by-name, idempotent):

| name           | suggestedIntervalKm |
| -------------- | ------------------- |
| Mineral        | 800                 |
| Semi-Synthetic | 1000                |
| Synthetic      | 1250                |

**These three numbers are assumptions I'm proposing, not values confirmed anywhere in the plan doc** — flagged explicitly since getting oil-change intervals wrong has a real-world cost (unlike, say, a maintenance-type label). Please confirm or correct these before the seed script actually runs. They're only ever a pre-fill default on the maintenance-log form — `intervalKmUsed` on each actual log is always user-editable regardless (per the break-in schedule requirement from `bike_log_project` memory: 6 oil changes across ~2000km, irregular spacing, never a flat number).

## Implementation

1. `engineOilType.service.ts`: implement `createEngineOilTypeIntoDB` (duplicate-key handling) and `getEngineOilTypesFromDB`.
2. `engineOilType.controller.ts`: wire real handlers.
3. Add `src/scripts/seedEngineOilTypes.ts` + a `yarn seed:engine-oil-types` package.json script, same pattern as spec 06.

## Dependencies

Spec 02 only.

## Verify-when-done

- [ ] `yarn build` / `yarn lint` clean.
- [ ] Duplicate `name` → 409, not a raw Mongo error.
- [ ] Seed script idempotent on repeat runs.
- [ ] Seeded `suggestedIntervalKm` values reviewed/confirmed by the user before relying on them in the frontend's form defaults.
