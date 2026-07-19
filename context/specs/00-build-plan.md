# Build Plan

`bikelog-server` is a greenfield build (currently just cloned boilerplate — see `context/progress-tracker.md`), so unlike a live project this file lays out the actual intended build order, taken from `bike log app/bike-log-plan.md`'s final section ("What's Next"). Each unit below should get its own numbered spec file (`01-<name>.md`, `02-<name>.md`, ...) written just before that unit is implemented, following the same format as this reference methodology (Goal / Design / Implementation / Dependencies / Verify-when-done) — none of those numbered files exist yet.

## Build Order

1. **Auth + Bike** — adapt/replace the cloned `user` module for Bike Log (JWT register/login, `argon2` hashing already in place), add the `bike` module (CRUD, ownership-scoped to `req.user`). Foundation everything else depends on.
2. **FuelLog + MileageRecord** — fuel-log CRUD plus the full-tank-to-full-tank exact mileage computation and rolling-average fallback (`bike-log-plan.md` §2.1).
3. **MaintenanceType + MaintenanceLog + reminders** — seeded maintenance-type catalog (starting with Engine Oil), maintenance-log CRUD with user-editable `intervalKmUsed`, and the due/overdue/upcoming reminders endpoint computed on read (`bike-log-plan.md` §2.2).
4. **Mileage & spending stats** — monthly/yearly/lifetime mileage endpoints and the spending-summary endpoint, both via the JS filter/reduce aggregation style (`bike-log-plan.md` §2.3, `context/architecture.md` invariant 6).
5. **Frontend (`bikelog-client`)** — Expo + React Native Web app wired to the above API, mirroring `expense-tracker-client`'s React Query/axios/`useFetchData` pattern (`bike-log-plan.md` §7). Separate project, not part of `bikelog-server`.
6. **Phase 2 — Tier 2 push** — `expoPushToken` on `User`, `POST /api/users/push-token`, and a Vercel Cron Job hitting `POST /api/cron/check-reminders` via `expo-server-sdk` (`bike-log-plan.md` §7.2). Only after the MVP above feels solid.

## Units

- [`01-module-scaffolding-and-models.md`](./01-module-scaffolding-and-models.md) — scaffolds `bike`/`fuelLog`/`mileageRecord`/`maintenanceType`/`engineOilType`/`maintenanceLog`/`spending` modules with fully implemented models but stub controller/service functions, wires every planned route into the main router, adapts `user` (adds `expoPushToken`), and retires the leftover `transaction` module. Complete.
- [`02-auth-hardening.md`](./02-auth-hardening.md) — fixes the `user` module's real bugs (unconditional password re-hash, password leaking in responses), adds the missing `GET /api/auth/me`, tightens `req.user` to a real `TJwtPayload` type, centralizes JWT expiry into config. Proposed — not yet implemented.
- [`03-bike-crud.md`](./03-bike-crud.md) — real `bike` CRUD logic, ownership-scoped to `req.user.userId`; defines the shared ownership-check and `currentOdometer`-bump helpers every later nested-resource module reuses. Proposed — not yet implemented.
- [`04-fuel-log-and-mileage-closure.md`](./04-fuel-log-and-mileage-closure.md) — real `fuelLog` CRUD plus the full-tank-to-full-tank mileage-closure algorithm that creates `MileageRecord`s (`bike-log-plan.md` §2.1). Proposed — not yet implemented.
- [`05-mileage-stats.md`](./05-mileage-stats.md) — real `mileageRecord` read-only stats endpoints (history + rolling-average, monthly/yearly/lifetime), via JS filter/reduce bucketed by `FuelLog.date`. Proposed — not yet implemented.
- [`06-maintenance-type-catalog.md`](./06-maintenance-type-catalog.md) — real `maintenanceType` create/list logic plus a proposed seed script for the 8 catalog categories. Proposed — not yet implemented.
- [`07-engine-oil-type-catalog.md`](./07-engine-oil-type-catalog.md) — real `engineOilType` create/list logic plus a proposed (assumption-flagged) seed script. Proposed — not yet implemented.
- [`08-maintenance-log-and-reminders.md`](./08-maintenance-log-and-reminders.md) — real `maintenanceLog` CRUD (server-computed `nextDueOdometer`) plus the due/overdue/upcoming `getReminders` logic (`bike-log-plan.md` §2.2). Proposed — not yet implemented.
- [`09-spending-summary.md`](./09-spending-summary.md) — real `spending` aggregation over `FuelLog`/`MaintenanceLog` costs, resolving the `targetMonth`/`targetYear` query-param gap left open in the interface. Proposed — not yet implemented.
