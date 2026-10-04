# 46: Per-user ownership for the maintenance-type and engine-oil-type catalogs (server)

Status: 🚧 In Progress — all code for both PRs is implemented, built and committed (2026-10-04), and **migration A plus the `--apply` backfill have now been run against production** (16 users, 112 + 49 copies, 32 logs re-pointed). What remains is the **deploy**, `--finalize`, and migration C — plus the H7/H4 notes in the runbook's new correction bullet. See the **Operator runbook** section at the end, and `context/progress-tracker.md` Current Phase for the step-by-step state.

Server half of a three-repo change. App counterpart: `bikelog_app/ai context/specs/48-per-user-catalogs.md`. Web counterpart: `bikelog_client-web-/context/specs/30-per-user-catalogs.md`. **This spec ships first** — but note the wire contract change is purely additive, so the clients are not blocked on it and can ship in either order afterwards.

**This spec changes live production data.** It is the first spec in this repo to do so since the Phase 8 Mongo cutover. Read §0 Hazards before anything else.

---

## Goal

Make both shared catalogs private per rider. Today `MaintenanceType` and `EngineOilType` are global: every user sees every other user's entries, and any authenticated user can rename or soft-delete anyone's entry by id.

The current state is deliberate, not accidental. Spec 38's Context section recorded it verbatim:

> Both models are global catalogs, not per-user/per-bike data — no `ownerId`/FK-to-`user` on either (`prisma/schema.prisma:80-103`). Any authenticated user can already create an entry (`authCheck` only, no role check); the update endpoint follows the same authorization level — **`authCheck` only, no ownership check (there is no owner to check against)**.

Spec 41 then built soft delete on that same assumption. The product has outgrown it. This spec supersedes that rationale rather than rewriting the history: there is now an owner to check against.

Two distinct defects are being fixed:

1. **Disclosure** — `getMaintenanceTypesFromDB()` / `getEngineOilTypesFromDB()` take zero arguments and filter only on `isDeleted`, so every user's list is every user's list.
2. **IDOR, two sites** — `updateXInDB`/`deleteXFromDB` look up by `id` alone, and more seriously `maintenanceLog.service.ts` validates a submitted catalog id with `{ id, isDeleted: false }` and no owner on **both** its create and update paths, while `userId` is already in scope. A user can attach another user's catalog row to their own log. The list leak is the visible symptom; this is the actual vulnerability.

## Confirmed decisions (with the user, 2026-10-04)

| Question                          | Decision                                                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| How many real accounts hold data? | **Several real users with real logs.** The backfill must be lossless.                                                                     |
| Existing catalog rows             | Copy every **live** row to **every** user. Copy a **soft-deleted** row only for users whose logs reference it, keeping `isDeleted: true`. |
| Existing maintenance logs         | **Re-pointed** to their own owner's copy. Nothing references an ownerless row afterwards.                                                 |
| New users                         | **Empty** catalogs. No seeding — spec 42 removed the seed scripts at the user's direct instruction.                                       |
| Rollout                           | Idempotent backfill **script** (not migration SQL), dry-run on a Neon branch of production first, then production.                        |
| Soft-deleted rows                 | Per the table above — follow their logs only, never copied to everyone.                                                                   |
| The `"Engine Oil"` magic string   | Replaced by a `requiresOilType` flag on `MaintenanceType` (see §G).                                                                       |
| Cross-user id → status            | **404**, not 403 (see §E).                                                                                                                |
| Scope                             | All three repos, deliberately.                                                                                                            |

---

## §0 Hazards

### H1 — `oilTypeId`'s FK is `ON DELETE SET NULL`. This is the one that can destroy data.

`prisma/migrations/20260914050701_init/migration.sql`:

```
L259  maintenance_logs_maintenanceTypeId_fkey  ... ON DELETE RESTRICT  ON UPDATE CASCADE
L262  maintenance_logs_oilTypeId_fkey          ... ON DELETE SET NULL  ON UPDATE CASCADE
```

The asymmetry decides the whole design of the backfill. For `MaintenanceType` the database protects us: if the backfill misses a log, deleting the original raises `P2003` and aborts. For **`EngineOilType` the same delete succeeds and silently nulls `oilTypeId` on every log that pointed at it** — no error, no 500, no log line, and no way to recover which oil type each log had used.

"Delete the orphaned originals" reads like trailing cleanup and is in fact the highest-risk operation in this spec.

**Mitigation:** the delete runs inside a transaction that **first asserts zero remaining references**, and it sits behind a separate `--finalize` invocation so it can never be a side effect of the copy phase. See §C phase 4.

### H2 — Deploy the new code _before_ the NOT NULL migration, not after.

`A → backfill → C → deploy` leaves a window where the DB has `ownerId NOT NULL` while the old code, which never writes `ownerId`, is still live: every catalog `POST` fails with Postgres `23502`, and `globalErrorHandler` has no branch for it, so users see "Something went wrong!!" with a 500.

`A → backfill → deploy → C` has no such window, and fixes the security defect at deploy time rather than at C.

### H3 — Migrations A and C cannot both be in the repo at once. This is two PRs.

`.github/workflows/deploy.yml` does **not** run migrations — it is `vercel pull` / `vercel build` / `vercel deploy` only. Migrations are applied by hand with `yarn db:migrate` → `prisma migrate deploy`. That decoupling is exactly what makes H2 possible.

But `migrate deploy` applies **all** pending migrations. If both folders are committed, it applies A and C in one shot and C fails on the all-`NULL` column.

- **PR1** — `schema.prisma` with `ownerId String?`, migration A, the backfill script, this spec marked In Progress. **No service changes.**
- **PR2** — `schema.prisma` with `ownerId String`, migration C, all service/controller changes, doc updates.

### H4 — Nothing enforces name uniqueness between A and the backfill.

A drops `maintenance_types_name_key` and `engine_oil_types_name_key`, and the new `(ownerId, name)` unique cannot fire while every `ownerId` is `NULL` — Postgres unique indexes are `NULLS DISTINCT` by default. So the still-deployed old code can create duplicate names in that window.

Accept it: the window is minutes and the consequence is cosmetic. But the backfill **must detect duplicate unowned names and abort with the list** rather than guess which to keep (§C phase 0).

### H5 — `dist/` is committed and is what Vercel serves.

`vercel.json` points at `dist/server.js`; 119 files under `dist/` are tracked. Every PR needs fresh `yarn build` output, and a deleted script must have its `dist/` artifact deleted too — spec 42's precedent.

### H6 — `where: { ownerId: null }` will not typecheck under PR2's schema.

Once `ownerId` is `String`, that is a type error and `yarn build` fails. The backfill must read the unowned ids through one raw query so it is schema-agnostic and survives both PRs:

```ts
const rows = await prisma.$queryRaw<{ id: string }[]>`
  SELECT id FROM maintenance_types WHERE "ownerId" IS NULL`;
```

Everything downstream then uses `where: { id: { in: ids } }`, which typechecks under both schema states.

### H7 — Verify the real production row name during the dry run.

Spec 06 seeded `"Engine Oil"`; `bikelog_app` spec 43 refers to `"Engine Oil Change"`. The backfill seeds `requiresOilType` from the actual name, so **check what production holds** rather than hardcoding. If it is the latter, both clients' oil-type dropdown is _already_ dead for every existing user today, independent of this change — record that finding here if so.

---

## Design

### §A Schema

**Final state (PR2).** Mirrors the `Bike` convention at `schema.prisma:47-78` exactly — scalar `ownerId String`, relation field named `owner`, **no `onDelete` argument**, plus `@@index([ownerId])`.

```prisma
model MaintenanceType {
  id                  String   @id
  ownerId             String
  name                String
  defaultIntervalKm   Int?
  defaultIntervalDays Int?
  requiresOilType     Boolean  @default(false)
  isDeleted           Boolean  @default(false)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  owner           User             @relation(fields: [ownerId], references: [id])
  maintenanceLogs MaintenanceLog[]

  // ! The unique deliberately covers soft-deleted rows (no partial index on isDeleted).
  // ! That is what keeps the revive-by-name path in createMaintenanceTypeIntoDB
  // ! load-bearing — see §B.
  @@unique([ownerId, name])
  @@index([ownerId])
  @@map("maintenance_types")
}
```

`EngineOilType` gets the same `ownerId`/`owner`/`@@unique([ownerId, name])`/`@@index([ownerId])` treatment and keeps `suggestedIntervalKm Float` (required). It does **not** get `requiresOilType`.

`User` gains two back-relations beside `bikes Bike[]`:

```prisma
  maintenanceTypes MaintenanceType[]
  engineOilTypes   EngineOilType[]
```

`Restrict` (Prisma's implicit default for a required relation with no `onDelete`) is safe here: there is **no user hard-delete anywhere in the server** — no `prisma.user.delete`, no `DELETE` route on the user module. Users are only ever soft-deleted via `isDeleted`.

**Intermediate state (PR1)** — identical except:

```prisma
  ownerId String?
  owner   User?   @relation(fields: [ownerId], references: [id], onDelete: Restrict)
```

The explicit `onDelete: Restrict` exists only so migration A emits the **final** FK semantics. PR2 drops the argument (required + no argument = `RESTRICT`, byte-identical SQL), which keeps migration C down to two `SET NOT NULL` statements instead of dropping and recreating the FK.

### §B Composite unique vs. soft delete

**Do not make the unique index partial on `isDeleted`.** It must cover soft-deleted rows.

The semantics become exactly today's, scoped down one axis:

- **Today:** at most one row per `name` globally, live or deleted. A user re-adding a deleted name hits `P2002`, which is precisely why spec 41 §F added the revive path.
- **After:** at most one row per `(ownerId, name)`, live or deleted. A user re-adding _their own_ deleted name hits `P2002` for the same reason, and the owner-scoped revive path handles it identically.

The walkthrough — user A soft-deletes "Oil Change", then re-adds it:

1. `findFirst({ where: { ownerId: A, name: "Oil Change", isDeleted: true } })` finds A's row.
2. Revive in place (`isDeleted: false` + the new intervals), **keeping its id**, so A's historical logs stay correctly labelled.
3. User B's "Oil Change" is a different row with a different id and is never consulted. No collision — the index key includes `ownerId`.

Had the index been partial (`WHERE isDeleted = false`), step 1's revive would become optional and step 2 would be an insert, leaving two rows for `(A, "Oil Change")` and breaking the "historical logs keep their real name" invariant that specs 41 and 42 both depend on.

**No collision is possible at backfill time:** `name` is globally unique _today_, so each name maps to exactly one original row, so each `(ownerId, name)` pair is produced at most once. A soft-deleted original can never collide with a live one, because they would have to share a name, which the current global unique forbids.

### §C Migration sequencing and the backfill

Generate each migration's SQL against a throwaway shadow DB — never `--from-schema-datasource` against production:

```bash
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "$NEON_BRANCH_UNPOOLED_URL" \
  --script
```

Run once per schema state. Confirm A's timestamp sorts before C's.

#### Migration A — `<ts>_catalog_add_owner` (PR1)

```sql
-- AlterTable
ALTER TABLE "maintenance_types" ADD COLUMN     "ownerId" TEXT;
ALTER TABLE "maintenance_types" ADD COLUMN     "requiresOilType" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "engine_oil_types"  ADD COLUMN     "ownerId" TEXT;

-- DropIndex
DROP INDEX "maintenance_types_name_key";
DROP INDEX "engine_oil_types_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_types_ownerId_name_key" ON "maintenance_types"("ownerId", "name");
CREATE UNIQUE INDEX "engine_oil_types_ownerId_name_key"  ON "engine_oil_types"("ownerId", "name");

-- CreateIndex
CREATE INDEX "maintenance_types_ownerId_idx" ON "maintenance_types"("ownerId");
CREATE INDEX "engine_oil_types_ownerId_idx"  ON "engine_oil_types"("ownerId");

-- AddForeignKey
ALTER TABLE "maintenance_types" ADD CONSTRAINT "maintenance_types_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "engine_oil_types" ADD CONSTRAINT "engine_oil_types_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

Why each statement is safe with the old code still deployed:

| Statement                                        | Effect on the running old version                                                                                                                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ADD COLUMN "ownerId" TEXT`                      | Nullable, no default → metadata-only on PG 11+, instant. The old generated client has no knowledge of the column: its `INSERT`s omit it (→ `NULL`), its `SELECT`s enumerate columns and never ask for it. **No effect.** |
| `ADD COLUMN "requiresOilType" ... DEFAULT false` | Same. **No effect.**                                                                                                                                                                                                     |
| `DROP INDEX ..._name_key`                        | The old `P2002` → 409 path stops firing; a duplicate name succeeds instead. **Behaviour change, cosmetic, bounded — this is H4.**                                                                                        |
| `CREATE UNIQUE INDEX (ownerId, name)`            | Every `ownerId` is `NULL` and the default is `NULLS DISTINCT`, so it can never conflict. **Inert until the backfill.**                                                                                                   |
| `CREATE INDEX (ownerId)`                         | Read-path only. **No effect.**                                                                                                                                                                                           |
| `ADD CONSTRAINT ... FOREIGN KEY`                 | Validated against existing rows, but `NULL` FK values skip the check, so validation is trivially satisfied. **No effect.**                                                                                               |

**Locking.** Prisma wraps the file in one transaction, so A is atomic. `ADD COLUMN`/`DROP INDEX` take a brief `ACCESS EXCLUSIVE` on two ~11-row tables; `CREATE UNIQUE INDEX` (non-concurrent) takes `SHARE`, blocking writes to those tables for milliseconds at this size. `ADD CONSTRAINT` additionally takes `ACCESS EXCLUSIVE` on **`users`** for the duration of validation — sub-millisecond here. _If these were large tables_ you would split into `ADD CONSTRAINT ... NOT VALID` + `VALIDATE CONSTRAINT` (only `SHARE UPDATE EXCLUSIVE`) and use `CREATE INDEX CONCURRENTLY` / `DROP INDEX CONCURRENTLY`, neither of which can run inside a transaction. **Not warranted at this row count**; recorded only so a future reader does not have to re-derive it.

#### Migration C — `<ts>_catalog_owner_not_null` (PR2)

```sql
-- AlterTable
ALTER TABLE "maintenance_types" ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "engine_oil_types"  ALTER COLUMN "ownerId" SET NOT NULL;
```

PR1's explicit `onDelete: Restrict` means the FK is already in its final form, so C has no constraint churn. `SET NOT NULL` takes `ACCESS EXCLUSIVE` and full-scans to verify — trivial here.

If C raises `23502`, **that is the gate doing its job**: a `NULL`-owner row was created in the deploy window. Inspect it, assign or delete it, re-run. Do **not** weaken the migration to tolerate it.

#### Inverse of A (documented rollback, not a Prisma down-migration)

Prisma 7 has no down-migrations, so keep this written out:

```sql
ALTER TABLE "maintenance_types" DROP CONSTRAINT "maintenance_types_ownerId_fkey";
ALTER TABLE "engine_oil_types"  DROP CONSTRAINT "engine_oil_types_ownerId_fkey";
DROP INDEX "maintenance_types_ownerId_name_key";
DROP INDEX "engine_oil_types_ownerId_name_key";
DROP INDEX "maintenance_types_ownerId_idx";
DROP INDEX "engine_oil_types_ownerId_idx";
ALTER TABLE "maintenance_types" DROP COLUMN "ownerId", DROP COLUMN "requiresOilType";
ALTER TABLE "engine_oil_types"  DROP COLUMN "ownerId";
CREATE UNIQUE INDEX "maintenance_types_name_key" ON "maintenance_types"("name");
CREATE UNIQUE INDEX "engine_oil_types_name_key"  ON "engine_oil_types"("name");
```

Valid only **before** `--finalize` runs, and only after deleting the copies the backfill created.

#### Execution order

| #   | Step                                                                         | Reversible?                 |
| --- | ---------------------------------------------------------------------------- | --------------------------- |
| 1   | Create Neon branch `spec46-dryrun` from production                           | yes (delete branch)         |
| 2   | Merge **PR1**                                                                | yes                         |
| 3   | Full dry run on the branch (§Test plan stage 2)                              | yes                         |
| 4   | **Production:** take the V1 before-snapshot                                  | —                           |
| 5   | **Production:** `yarn db:migrate` → applies A                                | yes (inverse SQL above)     |
| 6   | **Production:** backfill `--apply` (copies + re-points; originals untouched) | yes                         |
| 7   | **Production:** run V1–V7; `diff` the snapshots                              | —                           |
| 8   | Merge **PR2** → `deploy.yml` auto-deploys the new code                       | yes (revert + redeploy)     |
| 9   | **Production:** backfill `--finalize` (asserts, then deletes originals)      | **no — point of no return** |
| 10  | **Production:** `yarn db:migrate` → applies C                                | yes                         |
| 11  | Merge the app and web PRs                                                    | yes                         |
| 12  | End-to-end multi-user verification                                           | —                           |

Steps 5–10 are one sitting. What degrades in between:

- **5 → 8** (A applied, old code live, originals present). After step 6 the tables hold `users × rows` entries and the old list endpoint has no owner filter, so **every user sees every name repeated once per user**. With several users and ~11 types that is roughly 55 rows of visible duplication. Creates/updates/deletes still work (they key on id). This is the main cosmetic hazard and the reason to run 5–10 back-to-back.
- **8 → 9** (new code live, originals still present). Correct and safe: the new code filters by `ownerId`, so the ownerless originals are simply invisible to everyone.
- **9 → 10** (originals gone, C not yet applied). Correct. Any `NULL`-owner row created before step 8 makes step 10 fail loudly.

#### The backfill script

`src/scripts/backfillCatalogOwners.ts`, following the `migratePhase8MongoToPostgres.ts` precedent exactly: standalone `ts-node` entry point, header comment documenting invocation, imports `prisma` from `../app/lib/prisma`, console-reports counts, `process.exitCode = 1` on failure, `prisma.$disconnect()` in `finally`. **No `package.json` alias** — spec 42 just removed two, and `migratePhase8` never had one.

```bash
# dry run — default, writes nothing
npx ts-node --transpile-only src/scripts/backfillCatalogOwners.ts

# phases 1-3: create owned copies, re-point logs. Originals untouched.
npx ts-node --transpile-only src/scripts/backfillCatalogOwners.ts --apply

# phase 4: assert zero stray references, then delete the originals. IRREVERSIBLE.
npx ts-node --transpile-only src/scripts/backfillCatalogOwners.ts --finalize
```

`--finalize` is a separate invocation on purpose (H1): the only irreversible operation in this spec is never a side effect of the copy phase.

**Connection note.** `src/app/lib/prisma.ts` builds the `PrismaNeon` adapter from the pooled `config.database_url`, where interactive transactions time out at 5s. Either pass `{ timeout: 30_000, maxWait: 10_000 }` to `$transaction`, or run the script with `DATABASE_URL` temporarily set to the unpooled URL. The script **cannot run against local Postgres at all** — the adapter needs a real Neon host (spec 31b).

**Phase 0 — preconditions** (runs in every mode, dry run included):

1. Assert migration A is applied and C is not: query `information_schema.columns` for `ownerId` on both tables — require two rows, both `is_nullable = 'YES'`. Abort if fewer (A not applied) or if either is `'NO'` (C already applied).
2. Assert the index swap happened: query `pg_indexes` — require both `*_ownerId_name_key` present and both `*_name_key` absent.
3. Load users (`id`, `email`, `isDeleted`) and, per H6, the unowned ids via raw query; then load the original rows by `id in (...)`.
4. **H4 guard:** if any two unowned rows in the same table share a `name`, abort and print the list. A human decides which to keep; never guess.

**Phase 1 — referencing owners.** **No `isDeleted` filters anywhere in this phase** — lossless means a soft-deleted log on a soft-deleted bike of a soft-deleted user still counts.

```ts
const mtRefs = await prisma.maintenanceLog.findMany({
  where: { maintenanceTypeId: { in: unownedMtIds } },
  select: {
    id: true,
    maintenanceTypeId: true,
    bike: { select: { ownerId: true } },
  },
});
const oilRefs = await prisma.maintenanceLog.findMany({
  // ! `in` matches only non-null oilTypeId rows, so no code path below can ever
  // ! WRITE a null oilTypeId. That is the invariant that keeps H1 from firing.
  where: { oilTypeId: { in: unownedOilIds } },
  select: { id: true, oilTypeId: true, bike: { select: { ownerId: true } } },
});
```

Group each into `Map<oldCatalogId, Set<ownerId>>`.

**Phase 2 — target sets and owned copies.**

```
liveUserIds = users.filter(u => !u.isDeleted).map(u => u.id)

targets(row) = row.isDeleted
  ? refOwners(row.id)                        // deleted rows follow their logs only
  : union(liveUserIds, refOwners(row.id))    // live rows go to everyone, PLUS any
                                             // soft-deleted user whose logs reference them
```

The `union` with `refOwners` on the live branch is a **refinement of the confirmed decision**: without it, a soft-deleted user's logs reference an original that phase 4 then deletes — silently, for oil types.

```ts
await prisma.maintenanceType.upsert({
  where: { ownerId_name: { ownerId, name: r.name } },
  create: {
    id: generateObjectId(),
    ownerId,
    name: r.name,
    defaultIntervalKm: r.defaultIntervalKm,
    defaultIntervalDays: r.defaultIntervalDays,
    requiresOilType: isOilChangeName(r.name), // H7: seeded from the real production name
    isDeleted: r.isDeleted, // decision: deleted stays deleted
    createdAt: r.createdAt, // honest history
    updatedAt: r.updatedAt,
  },
  update: {},
});
```

Two things to comment in the file, or someone will "fix" them:

- **`update: {}` is deliberate and correct here.** Spec 42 criticised the deleted seed scripts for exactly this — an empty `update` never reconciles an existing row. For a _seed_ that was a flaw. For an idempotent backfill it is the required behaviour: a second run must not revert an edit the user made to their own copy after the first run.
- **Ids are freshly minted per copy** via `generateObjectId()`, per this repo's load-bearing app-generated-id convention. **Never reuse an original's id** for one of the copies — the originals are about to be deleted, and reuse would make the mapping ambiguous on re-run.

Record `(oldId, ownerId) → newId`. Idempotency is keyed purely on the `(ownerId, name)` unique; there is no run-state table to desync.

**Phase 3 — re-point the logs.**

```ts
for (const ref of mtRefs) {
  const newId = idMap.get(`${ref.maintenanceTypeId}|${ref.bike.ownerId}`);
  if (!newId) {
    // structurally impossible — phase 1 fed the target set. Loud, never silent.
    throw new Error(
      `No owned copy for type ${ref.maintenanceTypeId} / owner ${ref.bike.ownerId} (log ${ref.id})`,
    );
  }
  if (ref.maintenanceTypeId !== newId) {
    await prisma.maintenanceLog.update({
      where: { id: ref.id },
      data: { maintenanceTypeId: newId },
    });
  }
}
```

Same for `oilTypeId`, writing `{ oilTypeId: newId }` only — never `null`. Chunk the updates.

Self-skipping on re-run: after a successful pass the log points at a row with a non-null `ownerId`, so it is not in `unownedMtIds`, so phase 1 does not select it at all.

**Phase 4 — `--finalize` only.**

```ts
await prisma.$transaction(
  async (tx) => {
    // ! CRITICAL. maintenance_logs_oilTypeId_fkey is ON DELETE SET NULL (init migration L262).
    // ! Deleting a still-referenced engine_oil_types row does NOT raise P2003 — it silently
    // ! nulls the log's oilTypeId. This assertion is the only thing between a missed re-point
    // ! and permanent, unrecoverable loss. The maintenanceTypeId FK is RESTRICT and protects
    // ! itself; this one does not. See §0 H1.
    const strayMt = await tx.maintenanceLog.count({
      where: { maintenanceTypeId: { in: unownedMtIds } },
    });
    const strayOil = await tx.maintenanceLog.count({
      where: { oilTypeId: { in: unownedOilIds } },
    });
    if (strayMt || strayOil) {
      throw new Error(
        `ABORT: ${strayMt} maintenance + ${strayOil} oil references remain. Re-run --apply.`,
      );
    }

    await tx.maintenanceType.deleteMany({
      where: { id: { in: unownedMtIds } },
    });
    await tx.engineOilType.deleteMany({ where: { id: { in: unownedOilIds } } });
  },
  { timeout: 30_000, maxWait: 10_000 },
);
```

The assertion and the delete must be in **one transaction** so a concurrent write from the still-deployed old code cannot slip between them.

**Reported counts** — name every stage, in the narrative style this repo's scripts already use:

```
Preconditions:   migration A applied · composite unique present · global name unique absent   OK
Users:           N total (M live, K soft-deleted)
Originals:       maintenance_types X (x live, y deleted) · engine_oil_types Z
Log references:  maintenance_types P logs / Q ids · engine_oil_types R logs / S ids
Target copies:   maintenance_types T · engine_oil_types U
Copies created:  T / U      already present (skipped): 0 / 0
Logs re-pointed: P / R      already correct (skipped): 0 / 0
Unowned rows remaining: X / Z    <- --finalize deletes these
```

### §D Service and controller scoping

**New `src/app/modules/maintenanceType/maintenanceType.utils.ts`** and the mirror `engineOilType.utils.ts`, each following `bike.utils.ts:7-17`'s `findOwnedBikeOrThrow` shape — one query, one 404, collapsing "missing", "soft-deleted" and "someone else's" into a single path:

```ts
export const findOwnedMaintenanceTypeOrThrow = async (
  id: string,
  userId: string,
) => {
  const row = await prisma.maintenanceType.findFirst({
    where: { id, ownerId: userId, isDeleted: false },
  });
  if (!row)
    throw new AppError(httpStatus.NOT_FOUND, "Maintenance type not found");
  return row;
};
```

One helper per module rather than one generic helper over two Prisma delegates — the two modules are exact 5-file mirrors today and this repo leans on that property.

**Services.** All four functions in each module take `userId` as the **first positional argument**, matching the `bike`/`fuelLog`/`maintenanceLog` convention.

| Function                           | Change                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createXIntoDB(userId, payload)`   | Revive lookup becomes `findFirst({ where: { ownerId: userId, name, isDeleted: true } })`. Create writes `ownerId: userId`. The `P2002` → 409 catch stays **verbatim** — it now fires on `(ownerId, name)`, and its existing message ("A maintenance type with this name already exists") is finally _true_ from the user's point of view, which it was not before. |
| `getXFromDB(userId)`               | `findMany({ where: { ownerId: userId, isDeleted: false }, orderBy: { name: "asc" } })`. Was zero-arg.                                                                                                                                                                                                                                                              |
| `updateXInDB(userId, id, payload)` | Replace the `findUnique` + `!existing \|\| existing.isDeleted` guard with `await findOwnedXOrThrow(id, userId)`. `P2002` catch unchanged.                                                                                                                                                                                                                          |
| `deleteXFromDB(userId, id)`        | Same guard replacement. **The in-use `count` is unchanged** — `id` has just been proven to belong to `userId`, so every log it can match is necessarily this user's. Comment that explicitly, so nobody later "hardens" it with a redundant bike-owner join. The 409 sentence stays byte-identical; both clients render it verbatim in a warning toast.            |

The `{ ...row, _id: row.id }` inlining stays as-is at all six return sites in each module (there is no `toApiShape` helper here; introducing one is a separate cleanup). Responses now additively carry `ownerId` and `requiresOilType` — harmless, and both clients' types tolerate extra fields.

**Controllers.** All eight handlers currently never read `req.user` at all. Each gains `req.user.userId` as the first argument. `sendResponse` shapes and every message string unchanged.

**`maintenanceLog.service.ts` — the actual IDOR.** Four one-line additions of `ownerId: userId`, with `userId` already in scope at all four sites:

- L69-71 — create path, maintenance type
- L77-79 — create path, oil type
- L184-186 — update path, maintenance type
- L193-195 — update path, oil type

The update-path pair is the easy one to miss.

**`catalogInclude` (L17-20) must stay exactly as it is** — no owner filter, no `isDeleted` filter. It is what lets a historical log resolve the name of a since-deleted type (spec 41 §B), and after this change a log's type is owner-coherent _by construction_ (asserted by V4). Filtering here would add nothing and would re-break the exact bug spec 41 fixed. This is the tempting wrong move; leave a comment saying so. `getRemindersFromDB`'s non-optional `log.maintenanceType.name` (L330) stays safe for the same reason.

### §E Status code for a cross-user id: 404, not 403

1. **It is this repo's established convention for exactly this case.** `findOwnedBikeOrThrow` (`bike.utils.ts:14`) throws `404 "Bike not found"` for a bike that exists but belongs to someone else, and nine modules depend on that. A 403 would make the catalogs the only resource in the codebase that discloses "this exists, but not for you."
2. **It collapses three conditions into one code path** — non-existent id, soft-deleted id, and another user's id are indistinguishable to the caller and all land on one `findFirst` plus one throw. A 403 would require splitting the query to tell "exists but not yours" from "doesn't exist" — more code, worse privacy.
3. **It requires zero client changes.** Both clients already handle a 404 from these endpoints (it is the spec 41 soft-delete path) and both render `error.message` directly.
4. **The web client literally cannot observe a 403 today.** `bikelog_client-web-/utils/axiosInstance.ts:54` reads `error.response.data.statusCode`, which `globalErrorHandler` never sends (it sends `{ success, message, errorSources, stack }`), so that field is always 500. A new 403 would buy nothing observable and cost a change in both clients.
5. It does not confirm the existence of another user's resource.

Reuse the existing message strings verbatim: `"Maintenance type not found"` / `"Engine oil type not found"`.

### §F Routes stay top-level

`/maintenance-types` and `/engine-oil-types` keep their mounts in `src/app/router/index.ts:40-47`. The catalogs are owned by a **user**, not a bike, so nesting under `/bikes/:bikeId/...` would assert the wrong ownership axis and force a `findOwnedBikeOrThrow` call irrelevant to the resource. `/users/me/maintenance-types` would be marginally more RESTful but would change eight URLs across two clients for no functional gain — and, critically, it would make the wire-contract change **non-additive**, forfeiting the single biggest de-risking property of this plan: that the clients can ship independently of the server, in either order.

### §G The `requiresOilType` flag

Both clients gate the engine-oil dropdown on an exact name match — `selectedMaintType?.name === "Engine Oil"` (`bikelog_app/.../MaintenanceLogFormModal.tsx:70`, `bikelog_client-web-/.../MaintenanceLogFormModal.tsx:68`). That works today only because the global catalog was seeded with that row. With per-user catalogs and **no seeding** (decision 2), a brand-new user can never surface the oil-type field unless they happen to name a type exactly `"Engine Oil"`.

Per the user's decision, the gate moves to a real flag: `requiresOilType Boolean @default(false)` on `MaintenanceType`, set by the owner in the catalog UI. It costs no extra migration — it rides along in migration A.

Backfill seeds it from the actual production row name (H7). Web spec 07 §20 already admitted the name-match was a stand-in ("no separate 'is this an oil-type-needing category' flag exists on the backend, so this is inferred client-side by name"); this closes that.

Server-side work is only: the column, `requiresOilType: z.boolean().optional()` on the create and update schemas, and `requiresOilType?: boolean` on `TMaintenanceType`. The service passes it straight through — Prisma's `update({ data })` skips `undefined` keys, so the existing `Partial<T>` passthrough keeps working with no branching (spec 38's finding).

### §H Retire `migratePhase8MongoToPostgres.ts`

`migrateCatalogs()` (L46-48) opens with unconditional `prisma.maintenanceType.deleteMany({})` and `prisma.engineOilType.deleteMany({})`, then upserts without any owner field. Against the new schema the first raises `P2003` and **the second silently nulls every log's `oilTypeId`** — H1 weaponised, on production, as the script's first action. Its upserts would then fail the `NOT NULL` after C anyway.

The Mongo cutover completed 2026-09-15 and the root `CLAUDE.md` already lists retiring this script as an open decision. **Delete the file and its `dist/scripts/migratePhase8MongoToPostgres.js` artifact** (H5, spec 42's precedent). It is recoverable from git history, and this also removes one of the four `mongoose` importers documented in `CLAUDE.md:65` — a genuine side benefit.

If it must be kept as a historical artifact, the absolute minimum is a top-of-file `throw new Error("Retired — incompatible with per-user catalogs, see spec 46")` before any import side effects. A script whose first action is an unguarded `deleteMany` on an owner-scoped production table is a standing footgun.

### §I Postman collection

- Update the eight catalog request descriptions to state the per-user semantics, that a cross-user id returns 404, and that a brand-new user's list is legitimately empty.
- **Drop the 4 stale `yarn seed:maintenance-types` / `yarn seed:engine-oil-types` references** — spec 42 deleted those scripts but missed these descriptions.
- Add a `{{tokenB}}` collection variable and two negative requests: "List Maintenance Types as User B" and "Update User A's Maintenance Type as User B → 404".

With no test framework in this repo, the collection **is** the regression suite for this change.

---

## Implementation

### PR1 checklist

- [x] 1. `schema.prisma` — `ownerId String?` + `owner User?` (explicit `onDelete: Restrict`) + composite uniques + indexes + `requiresOilType` + `User` back-relations
- [x] 2. Generate migration A via `migrate diff`; verify the SQL matches §C — `20261004061500_catalog_add_owner`. Generated **offline** with `--from-schema <pre-change copy> --to-schema prisma/schema.prisma`, which needs no shadow DB at all (and `--from-schema-datamodel` no longer exists in Prisma 7.10 — the flag was renamed to `--from-schema`). Output is statement-for-statement §C's migration A; only the statement *order* differs (Prisma emits DropIndex → AlterTable → CreateIndex → AddForeignKey), which is semantically identical and equally safe per §C's own per-statement table.
- [x] 3. `src/scripts/backfillCatalogOwners.ts` — phases 0–4, three modes, all comments from §C. One deliberate divergence, commented in the file: phase 2 uses an explicit `findUnique`-then-`create` pair instead of `upsert({ ..., update: {} })`. Same effect, same idempotency guarantee, but it makes the created-vs-skipped counts reportable, which a no-op `upsert` cannot be.
- [x] 4. `yarn build` + `yarn lint`; commit fresh `dist/` (H5)
- [x] 5. Mark this spec **In Progress** in `context/progress-tracker.md`

### PR2 checklist

- [x] 1. `schema.prisma` — `ownerId String` + `owner User` (drop the `onDelete` arg); generate migration C → `20261004061600_catalog_owner_not_null`. The PR1 trick worked: `migrate diff` emits exactly the two `SET NOT NULL` statements and **no constraint churn**, confirming the FK was already in its final form.
- [x] 2. `maintenanceType.utils.ts` + `engineOilType.utils.ts` — the two `findOwnedXOrThrow` helpers
- [x] 3. Both catalog services — `userId` threaded through all four functions each (§D)
- [x] 4. Both catalog controllers — `req.user.userId` in all eight handlers
- [x] 5. Both catalog validations + interfaces — `requiresOilType`; **never** `ownerId` (both `T*` types carry an explicit comment saying why it is absent)
- [x] 6. `maintenanceLog.service.ts` — the four `ownerId: userId` additions; comment on `catalogInclude`
- [x] 7. Delete `migratePhase8MongoToPostgres.ts` + its `dist/` artifact (§H)
- [x] 8. Postman collection (§I) — `{{tokenB}}`, "Login as User B", the two negative requests, all ten catalog descriptions rewritten, the 4 stale `seed:*` references dropped. Also fixed 3 more of the same stale references in `postman/dummy-data.md`, which §I did not count but which are the identical defect.
- [x] 9. Docs — `CLAUDE.md` (both the soft-delete bullet and the mongoose-importer count, plus two new bullets), `AGENTS.md`, `context/architecture.md` (a new §, rather than rewriting its un-swept Mongoose-era prose), `context/project-overview.md`, `context/ai-workflow-rules.md` (including the now-false "greenfield build" opening, kept quoted for the record), root `CLAUDE.md`
- [x] 10. `yarn build` + `yarn lint`; commit fresh `dist/`
- [ ] 11. Mark **Complete** after step 12 of the execution order — **still open.** Steps 3–12 all mutate the live Neon database and were not run; see the runbook below.

### Doc updates (PR2)

- **`CLAUDE.md:51` is already stale** — it reads "Shared catalogs (`maintenanceType`, `engineOilType`) and derived data (`mileageRecord`) deliberately have no soft delete", which spec 41 falsified. Rewrite for per-user, soft-deletable catalogs, and add both models to the list whose every query needs `isDeleted: false` **and** `ownerId`.
- **`CLAUDE.md:65`** — the four-`mongoose`-importers list, now three (§H).
- **`AGENTS.md`** — the duplicate-key note: `P2002` now fires on `(ownerId, name)`.
- **`context/ai-workflow-rules.md`** — its Verification Checklist lists only `Bike`, `FuelLog`, `MaintenanceLog` as owner-bearing resources; add both catalogs. Also note that its opening claim, "This is a **greenfield build** … there's no production traffic or existing users to avoid breaking", is now flatly false — and is the assumption that produced this defect.
- **`context/architecture.md`, `context/project-overview.md`** — the catalog descriptions. Note spec 38's "no owner to check against" rationale as superseded; do not rewrite it.
- **Root `CLAUDE.md`** — the Phase 8 / scripts-of-note / mongoose-cleanup notes, given §H.

---

## Test plan

No test framework exists (`yarn test` is a stub that exits 1). Note that specs 44/45 cite `sqa-evidence/sqa.test.js` and `TESTING_REPORT.md` — **neither file exists nor was ever committed**, so there is no harness to extend. Verification is `yarn build` + `yarn lint` + the Postman collection + manual exercise, per this repo's actual practice.

### Stage 1 — static, both PRs

- `yarn build` clean. Watch H6 against PR2's schema.
- `yarn lint` — no _new_ errors; the ~5 pre-existing ones sit outside the Bike Log modules. Deleting `migratePhase8` should _reduce_ the count.
- `grep -rn "seed:maintenance-types\|seed:engine-oil-types"` → no hits in the Postman collection or live docs.
- Confirm `prisma/migrations/` holds **only** A when step 5 runs (H3).

### Stage 2 — Neon branch dry run (the rehearsal)

```bash
neon branches create --name spec46-dryrun --parent production
neon connection-string spec46-dryrun --pooled   # -> DATABASE_URL
neon connection-string spec46-dryrun            # -> DATABASE_URL_UNPOOLED
```

Then: `yarn db:migrate` → V1 snapshot → `--apply` → V2–V5, V7 → `--finalize` → V1 snapshot → `diff`. Pass criteria: **the V1 diff is byte-empty** and V2–V7 are all green.

Also:

- Run `--apply` **twice** to prove idempotency — the second run must report zero created and zero re-pointed, and a following `--finalize` zero deleted.
- **Deliberately break it once:** skip phase 3 and confirm `--finalize` aborts on the assertion rather than destroying data. This is the H1 regression test and the single most valuable thing in the dry run.

Delete the branch afterwards.

### Verification queries

```sql
-- V1 (THE proof of zero loss): every log's resolved type names. Before == after, byte-identical.
SELECT l.id, mt.name AS mt_name, COALESCE(ot.name,'<none>') AS oil_name
  FROM maintenance_logs l
  JOIN maintenance_types mt ON mt.id = l."maintenanceTypeId"
  LEFT JOIN engine_oil_types ot ON ot.id = l."oilTypeId"
 ORDER BY l.id;

-- V2: counts unchanged. The second is the H1 canary.
SELECT count(*) AS logs FROM maintenance_logs;
SELECT count(*) AS null_oil FROM maintenance_logs WHERE "oilTypeId" IS NULL;

-- V3: no broken FKs (0 and 0).
SELECT count(*) FROM maintenance_logs l
  LEFT JOIN maintenance_types mt ON mt.id = l."maintenanceTypeId" WHERE mt.id IS NULL;
SELECT count(*) FROM maintenance_logs l
  LEFT JOIN engine_oil_types ot ON ot.id = l."oilTypeId"
 WHERE l."oilTypeId" IS NOT NULL AND ot.id IS NULL;

-- V4: ownership coherence — a log's type must belong to the log's bike's owner (0 and 0).
SELECT count(*) FROM maintenance_logs l
  JOIN bikes b ON b.id = l."bikeId"
  JOIN maintenance_types mt ON mt.id = l."maintenanceTypeId"
 WHERE mt."ownerId" IS DISTINCT FROM b."ownerId";
SELECT count(*) FROM maintenance_logs l
  JOIN bikes b ON b.id = l."bikeId"
  JOIN engine_oil_types ot ON ot.id = l."oilTypeId"
 WHERE l."oilTypeId" IS NOT NULL AND ot."ownerId" IS DISTINCT FROM b."ownerId";

-- V5: the gate for migration C (0 and 0).
SELECT count(*) FROM maintenance_types WHERE "ownerId" IS NULL;
SELECT count(*) FROM engine_oil_types  WHERE "ownerId" IS NULL;

-- V6: the soft-delete decision — a deleted copy exists ONLY where that user's logs
--     reference it. Must return zero rows.
SELECT mt."ownerId", mt.name FROM maintenance_types mt WHERE mt."isDeleted"
EXCEPT
SELECT b."ownerId", mt.name
  FROM maintenance_logs l
  JOIN bikes b ON b.id = l."bikeId"
  JOIN maintenance_types mt ON mt.id = l."maintenanceTypeId"
 WHERE mt."isDeleted";

-- V7: per-user shape. Every live user should show the same live count.
SELECT u.email,
       count(*) FILTER (WHERE NOT mt."isDeleted") AS live,
       count(*) FILTER (WHERE mt."isDeleted")     AS deleted
  FROM users u LEFT JOIN maintenance_types mt ON mt."ownerId" = u.id
 GROUP BY u.email ORDER BY u.email;
```

### Stage 3 — multi-user API pass against the branch

Two throwaway users A and B, each with a bike, following spec 38's precedent (temporary local server on isolated port 5099 against the Neon branch, fixtures cleaned up afterwards via a temporary in-tree script).

| #   | Request                                                                       | Expect                                                                          |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | `GET /maintenance-types` as A                                                 | only A's rows                                                                   |
| 2   | `GET /maintenance-types` as B                                                 | only B's rows, zero `_id` overlap with #1                                       |
| 3   | `POST /maintenance-types` as B, name A already owns                           | **201** — the per-user namespace, and the H4 regression check                   |
| 4   | `POST /maintenance-types` as B, name B already owns                           | 409, existing message                                                           |
| 5   | `PATCH /maintenance-types/{A's id}` as B                                      | **404** `"Maintenance type not found"`                                          |
| 6   | `DELETE /maintenance-types/{A's id}` as B                                     | **404**; A's row still live afterwards                                          |
| 7   | `POST /bikes/{B}/maintenance-logs` with `maintenanceType: {A's id}`           | **404** — the IDOR                                                              |
| 8   | `PATCH /bikes/{B}/maintenance-logs/{id}` with `maintenanceType: {A's id}`     | **404** — the second IDOR site                                                  |
| 9   | #7 and #8 with `oilType: {A's oil id}`                                        | **404** both                                                                    |
| 10  | B soft-deletes "Oil Change", then re-creates it with a new interval           | 200, **same `_id`** revived, new interval, B's historical logs still labelled   |
| 11  | A creates "Oil Change" while B's is soft-deleted                              | 201, different `_id`, no collision                                              |
| 12  | B deletes a type a live log of B's uses                                       | 409, sentence byte-identical to pre-change                                      |
| 13  | `GET /bikes/{A}/maintenance-logs` as A                                        | every `maintenanceType` populated `{_id, name}`, names matching the V1 snapshot |
| 14  | `GET /bikes/{A}/reminders` as A                                               | populated `maintenanceType.name`, no crash (L330's non-optional access)         |
| 15  | `GET /bikes/{A}/spending-summary?period=lifetime` as A                        | category names unchanged; no `"Unknown"` appearing                              |
| 16  | AI spending insight for A's bike                                              | no crash (`ai.service.ts:200` non-optional `.name`)                             |
| 17  | Register a brand-new user C                                                   | both lists `[]` with 200, not 500 — decision 2                                  |
| 18  | C creates a type (with `requiresOilType` on), then a maintenance log using it | both 201                                                                        |

### Stage 4 — production, during steps 5–10

After step 6: V2–V5, V7. After step 7: the V1 `diff`. After step 8's deploy: a read-only spot check of #1, #2, #13, #14, #15 with a real token. After step 9: V1 `diff` again, then V2–V7. After step 10: V5 returns 0/0 and a throwaway create + delete succeeds.

---

## Explicitly NOT changing

- **`catalogInclude`** and its no-`isDeleted` comment (§D) — the tempting wrong move.
- **`toApiShape`** in `maintenanceLog.service.ts`, and the absence of one in the two catalog modules.
- **The in-use 409 count and its exact sentence** — both clients render it verbatim.
- **Endpoint paths** (§F) and the response envelope.
- **`ai.service.ts`, `spending.service.ts`, `notification.service.ts`** — all reach catalog names transitively through bike-scoped logs and stay correct.
- **`globalErrorHandler`** — no new branch; every new refusal throws `AppError`, already handled. (Its three dead Mongo-era branches and the absent central Prisma branch remain a separate, known cleanup.)
- **`ownerId` in any validation schema or interface** — adding it would reintroduce the IDOR through the front door.
- **`dist/`** — regenerated by `yarn build`, never hand-edited.

## Open items

- `requiresOilType` is set per type by its owner; no migration backfills it beyond the name match in §C phase 2. If H7 reveals production holds `"Engine Oil Change"`, record that the clients' dropdown was already dead and the flag is the fix.
- No audit trail on catalog edits — out of scope, same as spec 44's note on odometer history.
- Whether to centralise Prisma error mapping (`P2003`/`P2025`) in `globalErrorHandler` remains open; this spec deliberately keeps the guard-before-write pattern spec 41 established instead.

---

## Operator runbook — the part that is still open (added 2026-10-04)

All the code above is committed. Everything below touches the live Neon database and **was not run**: the implementing session had no access to it, not even a read. So the repo is currently *ahead of* the database — the committed `schema.prisma` declares `ownerId` as required while production still has it nullable and all-`NULL`.

### Read this first: both migrations are now in the repo at once

§0 H3 assumed PR1 and PR2 would land as two separate merges, with the backfill run in between. They landed back-to-back instead, so `prisma migrate deploy` now sees **both** A and C pending. A plain `yarn db:migrate` therefore applies A *and then* C, and C fails with Postgres `23502` on the all-`NULL` column.

That failure is the gate doing its job — A is applied, C's SQL is atomic so nothing of it lands, and **no data is touched or lost**. But it leaves C marked as a failed migration, which then needs `npx prisma migrate resolve --rolled-back 20261004061600_catalog_owner_not_null` before it can be retried. Avoid the detour by holding C back for the one command that applies A:

```bash
cd bikelog_server
mkdir -p /tmp/spec46-hold
mv prisma/migrations/20261004061600_catalog_owner_not_null /tmp/spec46-hold/
# ... steps 1-9 below ...
mv /tmp/spec46-hold/20261004061600_catalog_owner_not_null prisma/migrations/
```

Moving the folder changes nothing about the repo's committed state — put it back before step 10 and `git status` is clean again.

### The sequence

Rehearse the whole thing on a Neon branch of production first (§Test plan stage 2); only then repeat it against production. `neon` CLI is **not installed** on this machine — install it, or create the branch from the Neon console and copy both connection strings into `.env` (`DATABASE_URL` pooled, `DATABASE_URL_UNPOOLED` direct).

| # | Command / action | Notes |
| --- | --- | --- |
| 1 | Create Neon branch `spec46-dryrun` from production; point `.env` at it | Reversible — delete the branch |
| 2 | Take the **V1** before-snapshot | The proof of zero loss. `psql "$DATABASE_URL_UNPOOLED" -f v1.sql > before.txt` |
| 3 | Hold C back (above), then `yarn db:migrate` | Applies **A only**. Confirm with `\d maintenance_types` |
| 4 | `npx ts-node --transpile-only src/scripts/backfillCatalogOwners.ts` | Dry run. Settles **H7** — read the `requiresOilType:` line it prints for the real production row name |
| 5 | `... backfillCatalogOwners.ts --apply` | Copies + re-points. Originals untouched, fully reversible |
| 6 | Run **V2–V5, V7**; re-take V1 and `diff` | Pass criterion: the V1 diff is **byte-empty** |
| 7 | Run `--apply` a second time | Idempotency proof: must report 0 created, 0 re-pointed |
| 8 | **Break it deliberately once** — on a throwaway branch, skip step 5 and run `--finalize` | The H1 regression test, and the single most valuable thing in the dry run. It must abort on the assertion, not destroy data |
| 9 | `... backfillCatalogOwners.ts --finalize` | **Irreversible.** Asserts, then deletes the originals |
| 10 | Restore the C folder, then `yarn db:migrate` | Applies **C**. If it raises `23502`, a `NULL`-owner row was created in the window — inspect, assign or delete it, re-run. Do **not** weaken the migration |
| 11 | V5 returns 0/0; a throwaway create + delete succeeds | |
| 12 | Point `.env` back at production and repeat 2–11 there | Then §Test plan stage 3's 18-request multi-user pass |

Two notes on the window between steps 3 and 9 on production:

- After step 5 the tables hold `users × rows` entries while the **deployed** code still has no owner filter, so every user sees every name repeated once per user — with several users and ~11 types, roughly 55 rows of visible duplication. Creates/updates/deletes still work. This is the main cosmetic hazard and the reason to run the sequence in one sitting.
- **CORRECTION (2026-10-04, during the actual rollout):** the bullet below is wrong. The spec 46 commits were **never pushed or deployed** — production Vercel serves `master`, which does not contain them. So after step 5 the deployed, owner-blind code returned all 173 rows (12 originals + 161 copies) to every user, each name repeated 17 times, and §0 H2's ordering hazard **does** apply: the deploy must happen before `--finalize` and migration C. Read the bullet below as the condition the rollout was *supposed* to meet, not as a fact about it.
- The ordering hazard §0 H2 warns about does **not** apply here, because the new code is already merged and deployed — this sequence is `A → backfill → finalize → C` against code that already filters by `ownerId`, which means the ownerless originals are invisible to everyone from the moment migration A lands. That is the safe ordering, not the dangerous one.

### Unverified claims

Nothing in this spec was exercised at runtime. Verification was `yarn build` + `yarn lint` + a static read; the Postman requests are written but unrun, and the `PrismaNeon` adapter cannot be pointed at local Postgres as a substitute (spec 31b). Treat every behavioural statement as derived from the code, not observed.
