# Postgres Migration — Phase 6: `errorLog`

## Status

Proposed — not yet implemented. Sixth of the phased Mongoose→Prisma rewrites from `mongodb-to-postgres-migration-plan.md` (repo root). **Contains an open decision (§B) the top-level plan explicitly reserved for your call — this spec presents both options but does not pick one.** No FK dependency on any other model (`ErrorLog` has no `@relation` in `prisma/schema.prisma`), so this phase has no ordering dependency on Phases 1–5 beyond Phase 0's infra — it could technically run earlier, but is sequenced last-but-one to match the top-level plan's stated priority ("lowest priority").

## Goal

Rewrite `errorLog` — and, critically, keep `globalErrorHandler.ts`'s unconditional call into it working throughout. Two things make this module different from every other phase:

1. **It's the one Mongoose collection with no soft delete and no direct client-facing consumer besides an admin-only endpoint** (`adminCheck`-gated, confirmed via `errorLog.route.ts` — not used by either frontend client, only Postman/manual admin queries).
2. **It's invoked unconditionally, on every single error response, from every module in this codebase** — `globalErrorHandler.ts` calls `errorLogServices.createErrorLog(...)` inside a try/catch that swallows its own failures (so a logging failure never blocks the real error response), but that also means this call path is live and exercised constantly throughout Phases 1–5's development, not something that can wait.

## Design decisions

### A. Response shape — same `_id` convention, no known client dependency

Apply the same `{ ...row, _id: row.id }` remap as every other phase for consistency (`getErrorLogsFromDB`/`getErrorLogByIdFromDB`), even though no client type was found requiring it — this endpoint is admin/Postman-only, but matching the rest of the API's shape is simpler than special-casing one module, and costs nothing.

### B. Open decision (top-level plan #10) — Postgres has no TTL index; two separate questions, not one

Mongo's `errorLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 })` auto-deletes rows 30 days after creation via a background sweep — Postgres has no built-in equivalent (`pg_cron` isn't available on all Neon plans; the alternative is a scheduled job). This needs an answer on **two independent axes** — don't conflate them:

**Axis 1 — ongoing retention going forward (needed regardless of the historical-data answer below):**
Without *some* mechanism, `error_logs` grows unbounded in Postgres from the moment this phase lands (it's hit on every error, including expected ones like validation 400s). Proposed approach, mirroring the already-existing `weekly-summary-cron.yml` pattern:
- New endpoint, e.g. `POST /api/cron/cleanup-error-logs`, secret-protected the same way as `POST /api/cron/weekly-summary` (an `x-cron-secret` header checked against `config.cronSecret` — reuse the same secret or a new one, your call during implementation) — runs `prisma.errorLog.deleteMany({ where: { createdAt: { lt: thirtyDaysAgo } } })`.
- New GitHub Actions workflow, e.g. `.github/workflows/daily-error-log-cleanup.yml` (`schedule:` cron, plus manual `workflow_dispatch`), same shape as `weekly-summary-cron.yml`, POSTing to the new endpoint daily.
- Alternative if Neon plan supports it: `pg_cron` scheduling the delete directly in Postgres, no new endpoint/workflow needed — simpler if available, but not guaranteed across Neon tiers (confirm your plan supports it before choosing this path over the GitHub Actions one).

**Axis 2 — historical row migration at cutover (Phase 8, top-level plan's original #10 framing)** — only matters once, at the real data-copy step, unrelated to this phase's own implementation:
- **(a)** Migrate existing Mongo error-log rows too, for completeness.
- **(b)** Start `error_logs` fresh/empty on Postgres, skip migrating historical rows (most would already be within 30 days of self-deleting in Mongo by the time cutover happens anyway).

**This spec does not resolve either axis** — flag your preference on both before implementation starts. Axis 1 has a real, if modest, implementation cost (new endpoint + workflow) that's worth confirming before writing it; Axis 2 only affects Phase 8's migration script (one line of scope, either include `ErrorLog` in the copy order or don't) and can genuinely be decided later without blocking this phase's own code.

### C. List endpoint — third consumer of `buildPrismaListQuery`

`getErrorLogsFromDB` calls `Queryuilder` with **no base filter at all** (`errorLogModel.find()`, unscoped — this is the one `Queryuilder` consumer with no ownership/bike scoping, since it's admin-only and meant to see everything) and no explicit default sort (relies on `Queryuilder.sort()`'s own `"-createdAt"` fallback). Maps directly:
```ts
const { where, orderBy, skip, take } = buildPrismaListQuery({
  baseWhere: {},
  query,        // no IDOR-stripping needed here — admin-only endpoint, no bike/user scoping to protect
  defaultSort: "-createdAt",
});
```
No sanitization step needed before this call (unlike every bike-scoped module) — there's no `bike`/`isDeleted` ownership filter this endpoint could be tricked into overriding, since it was never scoped to begin with.

### D. `errorSources` — `Json?`, no per-item id needed

Unlike `bikeIssue.images[]`/`bikeDocument.files[]` (spec 35 §B), `errorSources` is never individually addressed by id (no delete-single-source endpoint exists or is planned) — it's written once at creation and read back as a whole blob. Store the array as-is in the `Json?` column, no synthesized-id treatment needed.

### E. `createErrorLog` must stay working through every other phase — not this phase's concern to guarantee, but worth stating explicitly

Nothing about deferring this module to Phase 6 breaks the other phases' error handling: `globalErrorHandler.ts` keeps calling the **Mongoose** `errorLogServices.createErrorLog` (this module untouched) all the way through Phases 1–5, exactly as it does today, since nothing else in the codebase reaches into `errorLog.model.ts` or depends on error logs being Postgres-backed. The only thing that changes at this phase's boundary is which database receives new error logs going forward — no other module's behavior depends on that.

## Implementation

1. `errorLog.service.ts` — rewrite all 3 functions (`createErrorLog`, `getErrorLogsFromDB`, `getErrorLogByIdFromDB`) per §A, §C, §D.
2. `errorLog.interface.ts` — drop nothing Mongoose-specific to begin with (`TErrorLog` is already a plain type, no `ObjectId` fields) — likely no change needed, confirm during implementation.
3. Per §B's eventual answer: possibly a new `errorLog.controller.ts` cron endpoint (`cleanupExpiredErrorLogs` or similar), wired into `errorLog.route.ts` (protected the same way `notification.controller.ts`'s cron endpoint is), plus the new GitHub Actions workflow file.
4. `errorLog.model.ts` — **do not delete** yet: `globalErrorHandler.ts` is the one importer, and it should switch to `errorLogServices.createErrorLog` (already true today — it goes through the service layer, not the model directly) so no separate change is needed there; delete the model file once this phase's rewrite lands and nothing else references it (should be immediate, unlike every other phase's deletion — `errorLog.model.ts` has no cross-module direct importers besides `globalErrorHandler.ts` going through the service layer, confirmed via grep).
5. `errorLog.controller.ts` / `.route.ts` — expected no-op for the two existing endpoints, plus §B's new endpoint if axis 1 goes the GitHub-Actions-cron route.

## Files touched

- `src/app/modules/errorLog/errorLog.service.ts` (rewrite)
- `src/app/modules/errorLog/errorLog.model.ts` (deletable this phase, unlike other phases' models — see §Implementation.4)
- Possibly: `src/app/modules/errorLog/errorLog.controller.ts`, `.route.ts` (new cron endpoint, pending §B)
- Possibly: `.github/workflows/daily-error-log-cleanup.yml` (new, pending §B axis 1)
- Not touched: `globalErrorHandler.ts` (already goes through the service layer, no change needed regardless of §B's answer).

## Out of scope for this phase

- `spending`, `ai`, `notification` — Phase 7.
- Phase 8's actual migration-script inclusion/exclusion of `ErrorLog` rows — depends on §B axis 2's answer, executed later, not part of this phase's own code.

## Dependencies

Phase 0 (infra) only. No FK dependency on any other phase.

## Verify-when-done

- [ ] `yarn build` / `yarn lint` clean.
- [ ] Trigger a real error (e.g. an invalid request hitting Zod validation) against the Prisma-backed server, confirm a row lands in Postgres `error_logs` with correct `status`/`message`/`errorSources`/`method`/`path`.
- [ ] `GET /api/error-logs` (admin token) and `GET /api/error-logs/:id` work, response includes `_id`; sort/pagination/filter behave the same as pre-migration.
- [ ] Non-admin token → `403` on both endpoints, unchanged.
- [ ] §B axis 1 resolved and implemented (or explicitly deferred with the user's sign-off recorded) — confirm `error_logs` has *some* bounded-retention mechanism before this phase is considered done, not left to grow unbounded indefinitely.
- [ ] §B axis 2 answer recorded (even if "decide later at Phase 8") so Phase 8's migration-script spec doesn't have to re-ask.
- [ ] Confirm `errorLog.model.ts` was actually deleted (per §Implementation.4) or, if kept, document why re-grep found an unexpected importer.
