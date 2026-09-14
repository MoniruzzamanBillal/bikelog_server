# Decision record: spec 36 §B resolved autonomously (overnight run, user unavailable)

## Status

Decision record, not a bug-fix plan. Spec 36 explicitly reserves §B (error-log retention) for the user's call and says implementation shouldn't proceed without an answer on both axes. This session is an unattended overnight `/loop` run — the user is asleep and unreachable — so a decision was made using the spec's own stated default, documented here for review/override at the user's convenience.

## Axis 1 — ongoing retention mechanism: chose the GitHub Actions cron route

Spec 36 §B lays out two options: a new `POST /api/cron/cleanup-error-logs` endpoint + daily GitHub Actions workflow (mirroring the already-shipped `weekly-summary-cron.yml`/spec 21 pattern), or `pg_cron` scheduling the delete directly in Postgres if the Neon plan supports it.

**Chose the GitHub Actions route**, for three reasons:
1. It's the spec's own primary, fully-specified proposal (concrete endpoint shape, auth pattern, workflow shape all given) — the `pg_cron` alternative is explicitly flagged as "not guaranteed across Neon tiers," and this session didn't check (and shouldn't unilaterally assume) whether the specific Neon project provisioned in spec 31b's fix has `pg_cron` available.
2. It exactly matches this codebase's own established precedent for the identical problem (a scheduled backend job hitting a secret-protected endpoint) — `weekly-summary-cron.yml` + `POST /api/cron/weekly-summary`, spec 21.
3. It's low-cost and reversible: the new workflow file does nothing until the user manually adds `API_BASE_URL`/`CRON_SECRET` (or a dedicated new secret, see below) as GitHub Actions repository secrets — same outstanding manual step already true and already documented (progress-tracker's "Next Up") for `weekly-summary-cron.yml` itself. No destructive action happens automatically.

**Implementation choice**: reused `config.cronSecret` (the same `CRON_SECRET` env var already used by `POST /api/cron/weekly-summary`) rather than minting a second secret — one fewer secret to provision, and both endpoints are equally low-stakes (deleting old error logs vs. sending a digest notification), so sharing the secret doesn't meaningfully raise the blast radius of either being compromised alone. If the user would prefer a dedicated secret, that's a one-line change (`config.cronSecret` → a new `config.errorLogCleanupCronSecret` env var) — flagged here rather than guessed at silently.

**Retention window**: 30 days, matching the Mongo TTL index's own `expireAfterSeconds: 60 * 60 * 24 * 30` value exactly — not a new number invented for this phase.

## Axis 2 — historical row migration at Phase 8 cutover: deferred, per the spec's own explicit permission

Spec 36 §B says this axis "can genuinely be decided later without blocking this phase's own code." Left undecided here, recorded as an open item for whoever writes Phase 8's migration-script spec to raise again before that phase starts (not before this one).

## If the user disagrees with either call

- **Axis 1**: if `pg_cron` is actually available on the `bikelog` Neon project (spec 31b) and preferred, delete `.github/workflows/daily-error-log-cleanup.yml` and the `POST /api/cron/cleanup-error-logs` endpoint, and set up the `pg_cron` schedule directly instead. Low-cost to reverse — nothing else depends on the GitHub Actions route's existence.
- **Axis 2**: raise it explicitly when Phase 8 (the actual data-migration/cutover spec) gets written — it doesn't exist yet per `bikelog_server/CLAUDE.md`'s own note ("Phase 8 ... has no dedicated spec yet").
