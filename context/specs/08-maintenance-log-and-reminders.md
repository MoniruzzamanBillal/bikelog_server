# Maintenance Log + Reminders

## Goal

Implement the six stub endpoints on `maintenanceLog` (5 CRUD + `getReminders`), including the server-side `nextDueOdometer` computation the validation schema already implies but doesn't accept from clients, and the due/overdue/upcoming reminder logic from `bike-log-plan.md` §2.2.

## Design

**Ownership:** every endpoint takes `:bikeId`, calls `findOwnedBikeOrThrow` (spec 03) first.

**Referential checks on create/update:** `maintenanceType` and (if present) `oilType` are ObjectId refs supplied by the client — verify both actually exist (`MaintenanceTypeModel.findById`, `EngineOilTypeModel.findById`) before saving; `AppError(404, "Maintenance type not found")` / `"Engine oil type not found"` if not. Prevents dangling refs from a typo'd/stale id.

**`nextDueOdometer` — always server-computed:** confirmed in spec 01's scaffolding that `createMaintenanceLogSchema`/`updateMaintenanceLogSchema` both omit `nextDueOdometer` even though it's required on the model — this was already the intended design, this spec just implements it: `nextDueOdometer = odometerReading + intervalKmUsed`, computed in the service, never accepted from `req.body` even if a client sends it (ignored, not merged).

**`currentOdometer` bump:** same `bumpOdometerIfHigher(bike, odometerReading)` helper from spec 03, called after saving.

**CRUD:**

- `createMaintenanceLogIntoDB`: ownership + referential checks → compute `nextDueOdometer` → save → bump odometer → return created log.
- `getMaintenanceLogsFromDB(bikeId, userId, query)`: ownership check → `.find({bike: bikeId}).sort("-serviceDate")` (event date, not `createdAt`) — propose `Queryuilder` here too (same rationale as fuelLog: this list grows over the bike's lifetime), with an optional `maintenanceType` filter param since a user will often want "just show me oil-change history."
- `getMaintenanceLogByIdFromDB`, `updateMaintenanceLogInDB`, `deleteMaintenanceLogFromDB`: ownership check; update recomputes `nextDueOdometer` if either `odometerReading` or `intervalKmUsed` changes (since it's derived from both — a partial update to just one must still keep the derived field correct, not stale).
- No "referenced by a closed record" lock here (unlike `fuelLog`/`MileageRecord`) — nothing else derives from a `MaintenanceLog` the way mileage closures do, so edits/deletes are unrestricted beyond ownership.

**`getReminders(bikeId, userId)`** → `GET /bikes/:bikeId/reminders`:

1. Ownership check, load `bike.currentOdometer`.
2. For each distinct `maintenanceType` this bike has at least one log for, find that type's **most recent** `MaintenanceLog` (by `serviceDate` descending).
3. Km-based status: `overdue` if `bike.currentOdometer >= nextDueOdometer`; `upcoming` if within a buffer (`nextDueOdometer - bike.currentOdometer <= 50`); otherwise omit that type from the response entirely (not due soon, nothing to show).
4. **Buffer = 50km**, taken from the example value already floated in `bike-log-plan.md` §2.2 and logged as an open question in `progress-tracker.md`. This spec locks it in as the default — flagged explicitly here since it was never actually confirmed; change before implementation if you want a different number (or want it configurable per `MaintenanceType` via `defaultIntervalKm`-style buffer, which would be a bigger change).
5. Time-based status (for types like Insurance/Registration that use `nextDueDate` instead of/alongside odometer): same due/upcoming logic but comparing `Date.now()` to `nextDueDate`, buffer in days (proposed default: 14 days) rather than km. A maintenance type can have both an odometer-based and date-based due point simultaneously (e.g. "whichever comes first") — this spec treats them independently and returns both flags if applicable, leaving it to the frontend to decide how to merge/display.
6. Response: `{ reminders: [{ maintenanceType, lastServiceDate, lastOdometerReading, nextDueOdometer, nextDueDate?, status: "overdue"|"upcoming", kmRemaining?, daysRemaining? }] }`.

## Implementation

1. `maintenanceLog.service.ts`: implement all 5 CRUD functions + `getRemindersFromDB`, reusing spec 03's ownership helper and a local `computeNextDueOdometer(odometerReading, intervalKmUsed)` one-liner.
2. `maintenanceLog.controller.ts`: wire real handlers for both exported routers' controller functions (CRUD + reminders both live in the same `maintenanceLogController` object per spec 01's scaffolding).
3. No validation-schema changes needed — spec 01's schemas already correctly omit `nextDueOdometer`.

## Dependencies

Spec 03 (ownership + odometer-bump helpers), spec 06 (`MaintenanceType` referential check), spec 07 (`EngineOilType` referential check) — logically sequenced after all three, though no circular code dependency.

## Verify-when-done

- [ ] `yarn build` / `yarn lint` clean.
- [ ] `nextDueOdometer` in the saved document always equals `odometerReading + intervalKmUsed`, even if a client tries to submit a different value directly.
- [ ] Updating just `intervalKmUsed` on an existing log recomputes `nextDueOdometer` correctly (doesn't go stale).
- [ ] Creating a log with a nonexistent `maintenanceType`/`oilType` id returns 404, not a Mongoose cast error.
- [ ] `getReminders` correctly flags `overdue` vs `upcoming` vs omitted, verified against a few hand-picked `currentOdometer`/`nextDueOdometer` combinations spanning all three cases.
- [ ] Reminders scoped correctly per bike — never mixing maintenance types/logs across two bikes owned by the same user.
