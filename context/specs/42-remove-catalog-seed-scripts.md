# 42: Remove the catalog seed scripts

Status: ✅ Complete — implemented and verified 2026-10-02.

Direct user instruction: _"remove the seed script . i will add data from the app and web ."_

---

## Goal

Delete the two catalog seed scripts and every current-state reference to them. Both catalogs are now populated entirely through the app and web clients, which have full create/edit/delete UI for them as of `bikelog_app` spec 45, `bikelog_client-web-` spec 28 and this repo's spec 41.

**This removes the scripts, not the data.** The 8 maintenance types and 3 engine oil types already in the database stay exactly where they are — this is a tooling change with no runtime, API or schema effect.

---

## Design

### Why they can go

The seed scripts existed because specs 06/07 needed a catalog to exist before any UI could create one. That premise is gone:

- `POST /maintenance-types` and `POST /engine-oil-types` have been live since specs 06/07.
- Both clients now ship full catalog management — create, inline edit, and (spec 41) delete with a referential guard.
- Spec 41 added revive-on-recreate, so re-adding a deleted name by hand restores the original row and its id. That covers the one recovery case the seed might otherwise have served.

### Why they were already a poor fit

Worth recording, because it is the reason this is a clean removal rather than a loss:

- **The seed could never repair drift.** Both scripts use `upsert({ where: { name }, update: {}, create: {...} })` — an **empty** `update`. An existing row is never touched. The live data has already drifted from the seed's own numbers (`Mineral` is 800 km in the database vs 1000 in the script; `Semi-Synthetic` 1600 vs 1500), and re-running would not have reconciled that. It only ever filled gaps.
- **The seed could not undo a soft delete either**, for the same reason — `update: {}` does not clear `isDeleted`. Verified empirically during spec 41 (see that spec's Verify). So post-spec-41 the script's only remaining behaviour was "insert rows that are missing by name", which the clients now do better and interactively.

### What is deliberately NOT touched

- **No data is deleted.** No migration, no `deleteMany`, nothing touches the `maintenance_types` or `engine_oil_types` tables.
- **`src/scripts/migratePhase8MongoToPostgres.ts` stays.** It is the historical Mongo→Postgres cutover script, unrelated to seeding, and retiring it is its own decision (tracked separately in the root `CLAUDE.md`'s migration-cleanup note).
- **Historical narrative is not rewritten.** `context/progress-tracker.md`'s Recent Activity entries and specs 06/07/31/34/41 describe what was true when written and keep their seed references. Only *current-state* docs are corrected. Falsifying the record to make it tidy would be worse than a stale-looking history entry.

---

## Implementation

1. Delete `src/scripts/seedMaintenanceTypes.ts` and `src/scripts/seedEngineOilTypes.ts`.
2. Delete their compiled output `dist/scripts/seedMaintenanceTypes.js` and `dist/scripts/seedEngineOilTypes.js`. **`dist/` is committed and is what Vercel actually serves** (`vercel.json` builds `dist/server.js`), so leaving stale build artifacts behind would be real, shipped dead code — not just untidy.
3. Remove the `seed:maintenance-types` and `seed:engine-oil-types` entries from `package.json`.
4. Update current-state docs: this repo's `CLAUDE.md` commands block, `AGENTS.md` command table, `context/project-overview.md`'s "(seeded, e.g. …)" claim, and the root `CLAUDE.md`'s "Server scripts of note" sentence.

### Files touched

`src/scripts/seedMaintenanceTypes.ts` (deleted) · `src/scripts/seedEngineOilTypes.ts` (deleted) · `dist/scripts/*.js` (deleted) · `package.json` · `CLAUDE.md` · `AGENTS.md` · `context/project-overview.md` · `context/progress-tracker.md` · `../CLAUDE.md`

---

## Dependencies

None. Nothing imports either script — they are standalone `ts-node` entry points invoked only through the two `package.json` aliases being removed.

---

## Verify

- [x] `grep -rn "seedMaintenanceTypes\|seedEngineOilTypes\|seed:maintenance-types\|seed:engine-oil-types"` returns only historical narrative (progress-tracker Recent Activity, old specs), no live code or current-state docs.
- [x] `yarn build` clean, and a fresh build leaves `dist/` with **no** reappearing seed artifacts.
- [x] `yarn lint` clean — **0 errors**. The two seed scripts were the source of 6 `no-console` warnings, which are now gone. The headline total still reads 19 purely by coincidence: 6 unrelated `no-console` warnings appeared in `src/app/modules/ai/ai.service.ts` at the same time, from in-flight debugging work in the working tree that is **not part of this spec and was not committed with it**. Removing the seed scripts took the count from 19 → 13 on its own.
- [x] The catalog rows are still present and unchanged in the database (the point of "scripts, not data").
- [x] `GET /maintenance-types` and `GET /engine-oil-types` still return the same rows — no runtime path touched.
