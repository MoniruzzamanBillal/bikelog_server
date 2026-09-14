# Fix: Phase 0 wired the Neon serverless driver to a plain local Postgres, which cannot work

## Status

Implementation-plan for an infra blocker discovered while manually verifying spec 31, not a new phase. Resolve as part of unblocking spec 31's verification, then keep this file as a record.

## Problem

`mongodb-to-postgres-migration-plan.md`'s Phase 0 line item says explicitly: "provision Neon; `prisma migrate dev` against it." `bikelog_server/src/app/lib/prisma.ts` (copied near-verbatim from `expenseTracker2/server`, per the plan) uses `@prisma/adapter-neon`'s `PrismaNeon` adapter, which drives Prisma queries through `@neondatabase/serverless` — a client that speaks Neon's own WebSocket/HTTP proxy protocol, not raw Postgres wire protocol.

The Phase-0 session that ran before this one instead pointed `DATABASE_URL`/`DATABASE_URL_UNPOOLED` at a **plain local Postgres** (`postgresql://postgres:123456@localhost:5432/bikelog_db`) — confirmed via `psql` that the DB and all 13 migrated tables exist there. `prisma migrate dev` (a plain SQL/wire-protocol operation, works with any Postgres) succeeded against it, which is why Phase 0 was signed off as "build/lint/dev all verified." But no actual Prisma **query** (the kind this phase's rewritten services perform) was run against it in that session — a real query is the first thing that exercises the `PrismaNeon`/`@neondatabase/serverless` code path, and that path cannot reach a plain local Postgres:

```
PROBE ERROR: ErrorEvent { type: 'error', ... }   // @neondatabase/serverless failing to speak its WS protocol to localhost:5432
```

Confirmed by comparing against `expenseTracker2/server`'s own `.env`: its `DATABASE_URL` is a real `*.neon.tech` host (`ep-spring-flower-...`), not local — that project's identical `lib/prisma.ts` works precisely because it always talks to an actual Neon endpoint, even from a local dev machine. Bikelog's Phase 0 deviated from the plan's own "provision Neon" instruction by substituting local Postgres, which is incompatible with the adapter the plan also mandates.

This blocks runtime verification of **every** phase (1 through 7), not just this one — any phase's rewritten service that issues a real `prisma.<model>.<query>()` call will hit the same `ErrorEvent`, regardless of which module it's in.

## Fix

Provision a real Neon Postgres project and re-point the app at it, matching the plan and `expenseTracker2/server`'s working precedent exactly. The local Postgres install and its already-applied migration history are discarded in favor of the Neon-hosted one (no data exists yet in either — Postgres was never live, so there is zero data-loss risk either way).

1. Confirm Neon CLI auth already present on this machine (it is — `neon profile list` shows an active account, the same one backing `expenseTracker2`'s and other projects' Neon databases). Per the `neon` skill's own guidance, an already-authenticated account is used directly; this is not a "no Neon account" / Claimable-Neon situation.
2. Create a new Neon project (name: `bikelog`, region matched to `expenseTracker2`'s `aws-ap-southeast-1` for consistency).
3. Pull its pooled and unpooled connection strings; set `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct, used by `prisma.config.ts`'s migration datasource) in `bikelog_server/.env`, replacing the `localhost:5432` values.
4. Run `npx prisma migrate deploy` (applying the existing `prisma/migrations/` history already committed from Phase 0) against the fresh Neon database — schema-only, no data to move.
5. Re-verify with a throwaway Prisma query (`prisma.user.count()`) that the `PrismaNeon` adapter now connects successfully.
6. Re-run this phase's manual verification (register/login/me/push-token, maintenance-type/engine-oil-type CRUD, both seed scripts) against the Neon-backed database.
7. Leave the local Postgres install/database alone (no need to drop it — simply unused going forward); don't delete `bikelog_db` in case the user wants it for something else.

## Out of scope

- Any schema/model change — this is purely a connection-target fix, the Prisma schema from Phase 0 is untouched.
- Re-provisioning `expenseTracker2`'s or any other existing Neon project — a new, dedicated project is created for `bikelog_server`.
- Production/Vercel env vars — this only fixes local `.env` for development; the deployed Vercel project's own env vars are a separate, later step (per the top-level plan's cutover phase), not touched here.

## Files touched

- `bikelog_server/.env` — `DATABASE_URL`, `DATABASE_URL_UNPOOLED` updated to the new Neon project's connection strings.

## Verify

- A raw Prisma query (`prisma.user.count()`) succeeds against the new Neon DB (no `ErrorEvent`).
- `POST /api/auth/register` / `/login` / `GET /api/auth/me` / `POST /api/auth/push-token` all succeed against Postgres (this phase's actual verification checklist, previously blocked).
- `POST /api/maintenance-types` / `POST /api/engine-oil-types` and their `GET` list endpoints succeed.
- `yarn seed:maintenance-types` / `yarn seed:engine-oil-types` run cleanly, idempotently, against the Neon DB.
