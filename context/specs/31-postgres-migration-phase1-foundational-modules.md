# Postgres Migration — Phase 1: Foundational Modules (`user`, `maintenanceType`, `engineOilType`)

## Status

Proposed — not yet implemented. This is the first of the phased Mongoose→Prisma rewrites laid out in `mongodb-to-postgres-migration-plan.md` (repo root, one level above `bikelog_server/`) — read that file in full before touching code here; this spec only turns its "Phase 1" line item into an actionable, module-accurate plan. Phase 0 (infra) is already done: `prisma/schema.prisma`, `prisma.config.ts`, `src/app/lib/prisma.ts`, `src/app/util/generateObjectId.ts` all exist and `prisma migrate dev` has been run against a local Postgres DB (`bikelog_db`) — see that session's summary / `git log` on the `postgressMigrate` branch.

## Goal

Rewrite the three modules with **no dependencies on any other not-yet-migrated module** — `user`, `maintenanceType`, `engineOilType` — from Mongoose to Prisma, plus the two catalog-seeding scripts that write into them. Zero data-loss risk in this phase specifically: Postgres starts empty, nothing here touches the live Mongo data, and (per the top-level plan) this phase is built and tested against the empty Postgres DB, not deployed as a replacement for the live server yet.

## Why these three, together, first

- `user` has no FK dependency on anything.
- `maintenanceType`/`engineOilType` are standalone catalogs (no FK either) — grouping them with `user` in one phase matches the top-level plan's Phase 1 exactly and lets all three be reviewed as one coherent, low-risk PR.
- Nothing downstream in *this* phase needs them yet — `Bike` (Phase 2) is the first model with a real FK (`ownerId → User`).

## Design decisions (module-specific, additive to the top-level plan's 11 numbered decisions)

### A. Response shape — every rewritten function must still return `_id`, not `id`

Verified by grep, not assumed: both web-client catalog types hard-require it —

```ts
// bikelog_client-web-/components/(main)/SettingsCatalog/type/maintenance-type.types.ts
export interface TMaintenanceType { _id: string; name: string; ... }
// .../engine-oil-type.types.ts
export interface TEngineOilType { _id: string; name: string; ... }
```

Mongoose auto-serializes `_id` on every returned document; Prisma returns a plain `id` field and does nothing magic. Every service function in this phase that returns a row (or array of rows) must map it before returning — same pattern as `expenseTracker2/server`'s migration (`{ ...row, _id: row.id }`, or `.map(...)` for lists). This isn't called out as its own numbered decision in the top-level plan (which mostly discusses ID *storage*, not response *shape*), but it's the same underlying issue ExpenseTracker's spec 01 flagged explicitly (§"Response shape compatibility") and it applies here just as directly — skipping it silently breaks both clients' catalog screens, not with an error, but with `undefined` keys/hrefs.

No dedicated `TUser` client-side type was found with the same `_id` requirement (`getMe`/`signIn` responses aren't strictly typed on the client), but map `_id` on `user` responses anyway for consistency and because `signIn`/`getMe`/`updatePushToken` all currently return whatever Mongoose hands back, `_id` included — changing that silently is exactly the kind of drive-by shape change the top-level plan says to avoid.

### B. Unique-constraint error handling changes shape

All three `create*` functions currently catch Mongo's duplicate-key error via `error.code === 11000`. Prisma throws `PrismaClientKnownRequestError` with `error.code === "P2002"` (string, not number) instead. Rewrite the catch blocks accordingly — same `AppError(httpStatus.CONFLICT, ...)` message, different detection:

```ts
import { Prisma } from "@prisma/client";
// ...
} catch (error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new AppError(httpStatus.CONFLICT, "...");
  }
  throw error;
}
```

### C. `user` — password hashing moves out of a Mongoose hook

`user.model.ts`'s `pre("save")` hook (hashes on `isModified("password")`) has no Prisma equivalent (Prisma 7 has no query middleware — this is decision #3 in the top-level plan, stated there for soft-delete but the same "no hooks" fact applies here too). `createUser` becomes the single place a user is ever created, so hash inline there with one explicit `argon2.hash(...)` call before `prisma.user.create(...)`. There is currently no other code path that updates `password` (`updatePushToken` only touches `expoPushToken`), so no other callsite needs a hashing check.

### D. `user` — `.select("-password")` becomes an explicit Prisma `select`

Three functions (`createUser`, `getMeFromDb`, `updatePushToken`) currently use Mongoose's `.select("-password")`. Prisma has no "select everything except" shorthand — use an explicit `select: { id: true, name: true, email: true, isDeleted: true, userRole: true, expoPushToken: true, createdAt: true, updatedAt: true }` (i.e. every `User` field except `password`), or fetch the full row and `delete result.password` before the `_id` remap — prefer the explicit `select` since it never risks leaking a new sensitive field added later.

### E. ID generation — every `create` needs an explicit ID

`prisma/schema.prisma`'s `id String @id` has no `@default(...)` (by design, decision #2 — new rows get an ObjectId-shaped string so ID format never changes). Every `prisma.<model>.create(...)` in this phase must pass `id: generateObjectId()` explicitly — Prisma will not generate one.

### F. `maintenanceType`/`engineOilType` — sort order

`.find().sort({ name: 1 })` → `prisma.maintenanceType.findMany({ orderBy: { name: "asc" } })` (same for `engineOilType`). No pagination in either today — keep as-is (tiny catalogs, per specs 06/07's own "no pagination" note).

### G. Seed scripts are currently broken by Phase 0's env rename — this phase is what fixes them

`src/scripts/seedMaintenanceTypes.ts` / `seedEngineOilTypes.ts` both read `process.env.DATABASE_URL` **directly** (bypassing `config/index.ts`) and `mongoose.connect()` it. Since Phase 0 repointed `DATABASE_URL` at Postgres and moved the real Mongo URI to `MONGO_DATABASE_URL`, running either seed script right now would try to `mongoose.connect()` a `postgresql://` string and fail immediately. This phase's rewrite fixes that as a side effect (the scripts move to Prisma entirely, so they stop touching Mongo/`DATABASE_URL` confusion altogether) — but flagging it explicitly so it isn't mistaken for a new bug introduced by this phase. Don't run either `yarn seed:*` script between now and this phase landing.

Rewritten scripts should import `prisma` from `../app/lib/prisma` (same client the app uses — no separate connection needed, these are tiny idempotent one-shot scripts) and switch from "find, then create if missing" to `prisma.<model>.upsert({ where: { name }, update: {}, create: { id: generateObjectId(), ...fields } })` — strictly equivalent behavior (idempotent, safe to re-run), just the more idiomatic Prisma phrasing for it, matching the migration script's own planned `upsert` pattern (top-level plan, "Migration script — outline").

## Known, accepted incoherence during Phases 1–7 (do not try to fix in this phase)

Two other modules import these three Mongoose models **directly** (not through the service layer) and are **out of scope** for this phase — they stay on Mongoose until their own phase:

- `maintenanceLog.service.ts` imports `maintenanceTypeModel`/`engineOilTypeModel` (`.findById(...)` in `createMaintenanceLog` and `updateMaintenanceLog`) — scheduled for Phase 4.
- `notification.service.ts` imports `userModel` (queries `expoPushToken` for the weekly-summary cron) — scheduled for Phase 7.

Because this phase leaves those two files untouched, they keep reading Mongo's copies of `MaintenanceType`/`EngineOilType`/`User` — which will **not** see anything created or edited through the newly-Prisma-backed `user`/`maintenanceType`/`engineOilType` endpoints once this phase lands. Concretely: a maintenance type added via the rewritten `POST /maintenance-types` after this phase ships won't be selectable when creating a maintenance log (still Mongo-backed) until Phase 4 rewrites that lookup too. This is the same acknowledged gap the top-level plan calls out for the whole migration ("you can't cut `Bike` over to Postgres while `FuelLog` still reads from Mongo... All Mongoose service code must be fully rewritten (Phases 1–7) before [cutover]") — it's expected, not a regression to chase down mid-phase. Don't paper over it with a temporary dual-write or a Mongo/Postgres sync shim; that's more risk for a state this phased plan already deliberately accepts as transient.

Practical effect on local testing (see Verify-when-done): this phase's manual verification is scoped to the three rewritten modules' own endpoints in isolation. A full click-through of "create maintenance type → use it on a maintenance log" is **not** a valid test until Phase 4 lands too.

## Implementation

For each of `user`, `maintenanceType`, `engineOilType`:

1. **`.service.ts`** — rewrite every function against `prisma.<model>`, applying decisions A–F above.
2. **`.interface.ts`** — keep the existing exported types that other files still import (`TUserRole`, `TJwtPayload`, `UserRole` — referenced from `authCheck.ts` and elsewhere, do not rename). Narrow `TUser`/`TMaintenanceType`/`TEngineOilType` to describe the create-payload shape only (`TUser` already close to this; drop `isDeleted` from it as a create-time input since it's server-defaulted); Prisma's generated row type (with `id`/timestamps/etc.) is a separate, unimported concern per ExpenseTracker's precedent.
3. **`.model.ts` — delete**, once nothing in the codebase imports it. Note the ordering constraint: `user.model.ts` can only be deleted after Phase 7 rewrites `notification.service.ts`, and `maintenanceType.model.ts`/`engineOilType.model.ts` only after Phase 4 rewrites `maintenanceLog.service.ts`'s two `.findById(...)` calls. **Do not delete any of the three `.model.ts` files in this phase** — leave them in place (unused by the rewritten service files, but still required by the two cross-module importers above) and delete each only when its last Mongoose importer is gone.
4. **`.controller.ts` / `.route.ts` / `.validation.ts`** — no changes expected; controllers call the same exported service function names with the same signatures, so this is a pass-through check, not a rewrite. Confirm after the rewrite (don't assume).
5. **Seed scripts** (`src/scripts/seedMaintenanceTypes.ts`, `seedEngineOilTypes.ts`) — rewrite per decision G.
6. Add `"@prisma/client"`'s `Prisma` namespace import wherever decision B's error-handling change is needed.

## Files touched

- `src/app/modules/user/user.services.ts` (rewrite)
- `src/app/modules/user/user.interface.ts` (trim `TUser`)
- `src/app/modules/maintenanceType/maintenanceType.service.ts` (rewrite)
- `src/app/modules/maintenanceType/maintenanceType.interface.ts` (trim, if needed)
- `src/app/modules/engineOilType/engineOilType.service.ts` (rewrite)
- `src/app/modules/engineOilType/engineOilType.interface.ts` (trim, if needed)
- `src/scripts/seedMaintenanceTypes.ts` (rewrite to Prisma + `upsert`)
- `src/scripts/seedEngineOilTypes.ts` (rewrite to Prisma + `upsert`)
- Not touched: all three `.model.ts` files (kept, per Implementation §3), `.controller.ts`/`.route.ts`/`.validation.ts` for all three modules (expected no-op, verify only), `server.ts` (already updated in Phase 0), `authCheck.ts` (no DB access, untouched).

## Out of scope for this phase

- `Bike` and anything depending on `User` via FK — Phase 2.
- `maintenanceLog.service.ts`'s two Mongoose lookups — Phase 4.
- `notification.service.ts`'s Mongoose lookup — Phase 7.
- Decision #10 (`ErrorLog` TTL handling) — separate open question, unrelated to this phase, still needs your call before Phase 6.
- Deleting any `.model.ts` file — see Implementation §3's ordering constraint.

## Dependencies

Phase 0 (infra) only — already complete.

## Verify-when-done

- [ ] `yarn build` / `yarn lint` clean.
- [ ] `POST /api/auth/register` creates a row in Postgres `users` (not Mongo) with `id` matching `generateObjectId()`'s hex-string shape, hashed password, `_id` present in the response body, no `password` field in the response.
- [ ] Duplicate email on register → `409`, message unchanged from today's wording.
- [ ] `POST /api/auth/login` still returns a valid JWT for a just-registered (Postgres) user; `argon2.verify` succeeds against the Prisma-stored hash.
- [ ] `GET /api/auth/me` and `POST /api/auth/push-token` both work against the Postgres-backed user, response includes `_id`, excludes `password`.
- [ ] `POST /api/maintenance-types` and `POST /api/engine-oil-types` create rows in Postgres; duplicate `name` → `409`; `GET` list endpoints return `_id`-shaped, name-sorted results.
- [ ] `yarn seed:maintenance-types` / `yarn seed:engine-oil-types` run cleanly against local Postgres, are safely re-runnable (upsert), and populate the same 8/3 catalog rows specs 06/07 originally seeded into Mongo.
- [ ] Confirmed via manual check (not just code review): the three `.model.ts` files are still present and unmodified, and `maintenanceLog`/`notification` endpoints still work exactly as before against Mongo (proving this phase didn't silently break the still-Mongoose-backed modules that import them).
- [ ] Postman collection: re-run the `auth`/`maintenance-types`/`engine-oil-types` folders end-to-end against local Postgres.
