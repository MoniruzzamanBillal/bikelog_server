# Module Scaffolding & Models

## Goal

Turn `bike-log-plan.md`'s data model and API surface into real module folders under `src/app/modules/` — fully implemented Mongoose models, but controller/service functions left as thin stubs. This gives the project real, routable structure (every planned endpoint reachable and wired into the main router) without committing to business-logic implementation yet. Each module's actual logic (§2 build-order units in `00-build-plan.md`) gets implemented in later, separate specs.

## Design

**New modules to create**, each `src/app/modules/<name>/` with `<name>.model.ts` / `.interface.ts` / `.validation.ts` / `.controller.ts` / `.service.ts` / `.route.ts`:

| Module            | Model              | Notes                                                                                                                                                                                                                                                                                                                  |
| ----------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bike`            | `Bike`             | owner ref, nickname, brand, model, registrationNumber, purchaseDate, fuelTankCapacityLiters, currentOdometer                                                                                                                                                                                                           |
| `fuelLog`         | `FuelLog`          | bike ref, odometerReading, litersAdded, isFullTank, pricePerLiter, totalCost, fuelStation, date, notes                                                                                                                                                                                                                 |
| `mileageRecord`   | `MileageRecord`    | bike ref, startOdometer, endOdometer, distanceKm, litersConsumed, mileageKmPerLiter, periodStartDate, periodEndDate, fuelLogIds. Also owns the read-only mileage-stats routes (`/mileage`, `/mileage/monthly`, `/mileage/yearly`, `/mileage/lifetime`) — these are views over this same data, not a separate resource. |
| `maintenanceType` | `MaintenanceType`  | name, defaultIntervalKm, defaultIntervalDays — small seeded catalog                                                                                                                                                                                                                                                    |
| `engineOilType`   | `EngineOilType`    | name, suggestedIntervalKm — kept as its own module (distinct model referenced by `MaintenanceLog.oilType`), not folded into `maintenanceType`                                                                                                                                                                          |
| `maintenanceLog`  | `MaintenanceLog`   | bike ref, maintenanceType ref, odometerReading, oilType ref, intervalKmUsed, nextDueOdometer, nextDueDate, cost, serviceDate, serviceCenter, partsReplaced, notes. Also owns `/reminders` (due/overdue/upcoming, computed on read from `currentOdometer` vs `nextDueOdometer`).                                        |
| `spending`        | _(none — derived)_ | no model, per plan §4 ("Spending is not a separate collection"); still gets interface/controller/service/route for `GET /bikes/:bikeId/spending-summary`                                                                                                                                                               |

**Existing `user` module** — adapt in place (not a new folder): add `expoPushToken` (nullable string, Phase 2 field) to `user.interface.ts` and `user.model.ts`. Keep the existing `argon2` password hashing untouched.

**Retire boilerplate** — remove the `transaction` module (unrelated to Bike Log): delete `src/app/modules/transaction/`, remove its entry from `router/index.ts`'s `routeArray`.

**Depth of implementation** (the "don't build all the logic yet" part):

- `.model.ts` — fully implemented Mongoose schema, matching `bike-log-plan.md` §4 field-for-field. `{ timestamps: true }` on all. `isDeleted: boolean` + `pre("find")`/`pre("findOne")` hooks on `Bike`, `FuelLog`, `MaintenanceLog` (user-facing records worth soft-deleting); `MaintenanceType`/`EngineOilType` (small shared catalogs) and `MileageRecord` (derived/auto-generated) don't need soft delete.
- `.interface.ts` — fully implemented `T`-prefixed types matching the model.
- `.validation.ts` — a real Zod schema mirroring the model's required fields, ready for `validateRequest` wiring on write routes.
- `.controller.ts` / `.service.ts` — function signatures only, one per planned endpoint (e.g. `createBike`, `getBikes`, `getBikeById`, `updateBike`, `deleteBike`). Controller functions are `catchAsync`-wrapped and throw `new AppError(httpStatus.NOT_IMPLEMENTED, "Not implemented yet")`; service functions are empty `async` bodies with a `// TODO` comment. This is enough to compile and be routable — no real business logic yet.
- `.route.ts` — a real `Router()` wiring every planned endpoint from `bike-log-plan.md` §5 to its stub controller function, with `authCheck` (and `validateRequest(schema)` on write routes) already in the middleware chain. Nested-resource routers (e.g. `fuel-logs` under `/bikes/:bikeId/...`) use `Router({ mergeParams: true })` so `bikeId` is visible from the parent mount.

**Router wiring**: each new module's router is added to `src/app/router/index.ts`'s `routeArray` under its path prefix (`/bikes`, `/bikes/:bikeId/fuel-logs`, `/bikes/:bikeId/mileage`, `/maintenance-types`, `/engine-oil-types`, `/bikes/:bikeId/maintenance-logs`, `/bikes/:bikeId/reminders`, `/bikes/:bikeId/spending-summary`), matching the endpoint list in `bike-log-plan.md` §5.

## Implementation

1. Delete `src/app/modules/transaction/`; remove its `routeArray` entry in `router/index.ts`.
2. Add `expoPushToken` to `user.interface.ts` / `user.model.ts`.
3. For each new module in the table above, create the 6 files (5 for `spending`, no model) per the "Depth of implementation" rules.
4. Register every new module's router in `router/index.ts`'s `routeArray`.
5. Confirm `yarn build` compiles cleanly with all the new stub modules in place.

## Dependencies

None — this is pure scaffolding on top of the existing boilerplate infra (`authCheck`, `validateRequest`, `catchAsync`, `sendResponse`, `AppError`), all of which is already reusable as-is (see `context/architecture.md`).

## Verify-when-done

- [ ] `yarn build` succeeds with no TypeScript errors.
- [ ] `yarn lint` is clean.
- [ ] Every endpoint listed in `bike-log-plan.md` §5 (except the Phase-2 push-token/cron routes) resolves to a route (returns `501 Not Implemented` via the stub controller, not a 404), confirming router wiring is correct.
- [ ] Every model field in the table above matches `bike-log-plan.md` §4 exactly — no invented or missing fields.
- [ ] `transaction` module fully removed; no references to it remain in `router/index.ts`.
