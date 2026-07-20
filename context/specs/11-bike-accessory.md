# Bike Accessory Tracking

## Goal

Add a new `bikeAccessory` module so a rider can log accessories they want to buy (e.g. phone mount, saddle bag) that they can't purchase immediately, tracking an urgency level and a purchase status per bike.

This is a deliberate scope expansion beyond the original `bike-log-plan.md` — that doc only mentions "accessories" once, as an example *maintenance-type catalog category name* ("insurance/registration renewal, accessories/other"), unrelated to a purchase wishlist. This module is new design surface, added on direct user request, motivated by a real constraint: the user can't always go to the accessories shop the moment they think of something (needs money/weekend time), so wants need to be tracked with an urgency level until they can actually be bought.

## Design

**Ownership:** `findOwnedBikeOrThrow` (spec 03) first, same as every other nested resource. Nested under bike (`/bikes/:bikeId/accessories`), matching the existing per-bike-nested pattern rather than a global per-user list — confirmed, since accessories are conceptually tied to a specific bike (e.g. a saddle bag sized for one bike's seat).

**`urgency` — exactly three values** (`immediate`/`medium`/`low`) and **`status` — exactly three values** (`pending`/`purchased`/`cancelled`), both `as const` objects in `bikeAccessory.constant.ts` (`AccessoryUrgency`, `AccessoryStatus`), enum-validated at the schema level via `enum: Object.values(...)`.

**No dedicated action endpoints — plain generic CRUD only.** Unlike `bikeIssue`, there is no history/recurrence requirement and no derived side effect tied to a status change — a rider just flips `status` from `pending` to `purchased` (or `cancelled`) directly. This is a deliberate contrast with `bikeIssue`'s resolve/reopen endpoints: the codebase's default is thin generic CRUD, and bespoke endpoints are reserved for cases with real side-effect logic, which doesn't apply here.

**No natural "event date" field.** Unlike `fuelLog.date`/`maintenanceLog.serviceDate`/`bikeIssue.dateReported`, an accessory wishlist entry has no meaningful event date to sort by, so the list endpoint uses `QueryBuilder`'s default `"-createdAt"` sort rather than passing an explicit field to `.sort()`.

**CRUD:**

- `createBikeAccessoryIntoDB`: ownership check → create with `bike: bikeId`; `urgency` required from the client, `status` optional (schema defaults to `pending` if omitted) — no forcing/stripping of `status` at create time, since nothing derives from it.
- `getBikeAccessoriesFromDB(bikeId, userId, query)`: ownership check → **strip `bike`/`isDeleted` from `query` before constructing `QueryBuilder`** (same IDOR-prevention rule as every other list endpoint in this codebase — `QueryBuilder.filter()`'s second `.find(queryObj)` call merges with last-write-wins over the ownership-scoped `.find()`, so an unsanitized `?bike=<otherBikeId>` would leak another bike's accessories) → `.find({ bike: bikeId, isDeleted: false }).filter().sort().pagination().field()`; `?urgency=` and `?status=` filters are free via `.filter()`.
- `getBikeAccessoryByIdFromDB`, `updateBikeAccessoryInDB`, `deleteBikeAccessoryFromDB`: ownership check + scoped `findOne`/`Object.assign`+`save()`/soft-delete, same shape as every other module — no field stripping needed on update since no field here is derived/protected.

## Implementation

1. `bikeAccessory.constant.ts`: `AccessoryUrgency` and `AccessoryStatus` `as const` objects + derived types.
2. `bikeAccessory.interface.ts`: `TBikeAccessory`.
3. `bikeAccessory.model.ts`: schema with both fields enum-validated (`enum: Object.values(...)`), `status` defaulting to `pending`, soft-delete `pre("find")`/`pre("findOne")` hooks.
4. `bikeAccessory.validation.ts`: `createBikeAccessorySchema` (name + urgency required), `updateBikeAccessorySchema` (all optional).
5. `bikeAccessory.service.ts`: all 5 CRUD functions per Design above.
6. `bikeAccessory.controller.ts`: 5 thin `catchAsync` wrappers using `sendResponse`.
7. `bikeAccessory.route.ts`: single `Router({ mergeParams: true })` exported as `bikeAccessoryRouter`.
8. `src/app/router/index.ts`: import `bikeAccessoryRouter`, add `{ path: "/bikes/:bikeId/accessories", route: bikeAccessoryRouter }` to `routeArray`.

## Dependencies

Spec 03 (`findOwnedBikeOrThrow`) only. No dependency on `bikeIssue` (spec 10) — the two modules are independent and can be implemented/verified in either order.

## Verify-when-done

- [ ] `yarn build` / `yarn lint` clean.
- [ ] Creating an accessory without `status` defaults to `pending`; without `urgency` returns 400 (required field).
- [ ] `enum` validation rejects an invalid `urgency`/`status` value at the schema level (not just Zod) — confirms the Mongoose-level guard is real, not only relying on request validation.
- [ ] `GET /bikes/:bikeId/accessories?urgency=immediate` and `?status=pending` correctly filter, individually and combined.
- [ ] `PATCH /:id` can freely move `status` through `pending → purchased` and `pending → cancelled` with no restriction (contrast with `bikeIssue`'s guarded transitions — confirms this module intentionally has no state machine).
- [ ] Soft-deleted accessories never reappear in subsequent list/get calls.
- [ ] `GET /bikes/:bikeId/accessories?bike=<anotherBikesId>` never leaks another bike's accessories.
- [ ] Accessories for bike A never appear in bike B's list/get/update/delete, even for the same authenticated user.
