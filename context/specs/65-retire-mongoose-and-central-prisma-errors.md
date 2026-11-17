# Spec 65 — Retire Mongoose, and give `globalErrorHandler` a central Prisma branch

**Status: Complete — implemented 2026-11-15 (code + `tsc`/`lint`/`build` verified; not exercised over HTTP).**

## Why

Two long-standing post-migration debts, flagged in `CLAUDE.md`'s own "Known gotchas":

1. **`globalErrorHandler.ts` branched on three Mongoose-era conditions** — `error.name ===
   "ValidationError"`, `error.name === "CastError"`, and Mongo's `error.code === 11000` —
   **none of which can fire under Prisma/Postgres**. Meanwhile it had **no central Prisma
   branch**: `P2002` was caught service-by-service, but `P2003` (FK) and `P2025` (record not
   found) fell through to a bare `500` with raw error text.
2. **`mongoose` was still an installed dependency**, imported by three dead/legacy files, two
   of them (the Mongo validation/cast handlers) still wired into the global handler.

## What

### Central Prisma error branch

New `src/app/Error/handlePrismaError.ts`:

- `handlePrismaKnownRequestError(e)` maps `Prisma.PrismaClientKnownRequestError` codes:
  `P2002` → **409** (`A record with this <field> already exists`), `P2025` → **404**,
  `P2003`/`P2000`/`P2011` → **400**, any other known code → a **logged 500** that surfaces
  the code (`Database error (P….)`) instead of a blank message.
- `handlePrismaValidationError(e)` maps `Prisma.PrismaClientValidationError` → **400** (a
  malformed query is a caller bug, not a server fault).

`globalErrorHandler.ts` rewritten to one `if/else-if` chain, most specific first: `ZodError`
→ `AppError` → `PrismaClientKnownRequestError` → `PrismaClientValidationError` → the existing
`500` default. The spec-51 refresh-token log-skip and the awaited `error_logs` write are
**unchanged**.

**`AppError` is checked before the Prisma branches on purpose.** Services still catch the
Prisma errors they want a domain message for (e.g. `P2002` on a catalog name → a friendly 409
in `user.services.ts` / `maintenanceType.service.ts` / `engineOilType.service.ts`) and
re-throw an `AppError`; only what they *don't* catch should reach the generic mapper. The
central P2002 is therefore a **safety net**, and its 409 matches those services' own choice,
so an uncaught duplicate and a caught one answer alike.

### Mongoose removed

- Deleted `src/app/Error/handleCatError.ts`, `handleValidationError.ts`,
  `handleDuplicateError.ts` (the Mongo cast / validation / `11000`-duplicate handlers) and
  `src/app/builder/Queryuilder.ts` (dead since `buildPrismaListQuery.ts` replaced it).
- Removed `mongoose` from `package.json`; `yarn install` pruned it (and its transitive deps —
  `yarn.lock` −110 lines, `node_modules/mongoose` gone).
- `server.ts`: removed the commented-out `mongoose.connect()` boot block (the last `mongoose`
  mention in `src/`).
- `config/index.ts`: removed the vestigial `mongo_database_url` key (zero readers) and fixed
  the stale `database_url` comment. The protected-file rule forbids *renaming* read keys; this
  key had no readers.

`grep -rn mongoose src/` is now empty.

## Hazards / decisions

- **H1 — behaviour change is strictly an improvement.** The deleted branches were already
  dead, so nothing that previously worked stops. `P2003`/`P2025`/stray `P2002` move from a
  bare 500 to a correct 4xx. No response that a client relied on changes shape.
- **H2 — service-local P2002 catches kept.** They give better messages than the generic
  mapper; the central branch only catches what escapes them.
- **H3 — no client cascade.** The error envelope (`{ success, message, errorSources, stack }`)
  is unchanged. The app already paints 409s amber, so uncaught duplicates now read correctly
  there for free; no app/web change. **Cascade step 3 untriggered.**
- **H4 — DEF-02/03 still open.** This spec does **not** address `globalErrorHandler` returning
  `stack` on every response / raw error text on 500s (the SQA High defect). The default-500
  message is unchanged by design; that hardening is a separate task.

## Verify

Static (done): `yarn build` (tsc → dist) clean, `eslint` clean on all changed files,
`prettier` clean, `grep -rn mongoose src/` empty, `node_modules/mongoose` absent.

Not run (operator) — over HTTP:
- V1 — a request that trips an **uncaught** `P2003` (delete a row another table still
  references) returns **400**, not 500.
- V2 — an update/delete of a non-existent id that reaches Prisma uncaught (`P2025`) returns
  **404**.
- V3 — the catalog duplicate-name flows still return their domain **409** (service-local
  catch, unchanged).
- V4 — a known-good request path is unaffected; the boot still runs `assertJwtSecrets()` then
  `prisma.$connect()`.
