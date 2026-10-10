/**
 * Spec 46 backfill: gives every `maintenance_types` / `engine_oil_types` row an owner.
 *
 * Copies each ownerless ("original") catalog row once per target user, re-points every
 * maintenance log at its own owner's copy, and — only under `--finalize` — deletes the
 * originals. Idempotent: keyed purely on the `(ownerId, name)` composite unique, with no
 * run-state table to desync.
 *
 * Usage:
 *   # dry run — the default, writes nothing
 *   npx ts-node --transpile-only src/scripts/backfillCatalogOwners.ts
 *
 *   # phases 1-3: create owned copies, re-point logs. Originals untouched.
 *   npx ts-node --transpile-only src/scripts/backfillCatalogOwners.ts --apply
 *
 *   # phase 4: assert zero stray references, then delete the originals. IRREVERSIBLE.
 *   npx ts-node --transpile-only src/scripts/backfillCatalogOwners.ts --finalize
 *
 * `--finalize` is a separate invocation on purpose (spec 46 §0 H1): the only irreversible
 * operation in this spec must never be a side effect of the copy phase.
 *
 * Preconditions: migration `20261004061500_catalog_add_owner` applied, migration
 * `*_catalog_owner_not_null` NOT yet applied. Phase 0 asserts both and aborts otherwise.
 *
 * Connection: `src/app/lib/prisma.ts` builds the PrismaNeon adapter from the *pooled*
 * `DATABASE_URL`, where interactive transactions time out at 5s — hence the explicit
 * `{ timeout, maxWait }` on the `--finalize` transaction. Run with `DATABASE_URL` set to
 * the unpooled URL if you prefer. This script cannot run against local Postgres at all:
 * the adapter needs a real Neon host (spec 31b).
 */
import { prisma } from "../app/lib/prisma";
import { generateObjectId } from "../app/util/generateObjectId";

type Mode = "dry" | "apply" | "finalize";

const mode: Mode = process.argv.includes("--finalize")
  ? "finalize"
  : process.argv.includes("--apply")
    ? "apply"
    : "dry";

const CHUNK = 50;

// ! H7: the oil-change row's real production name decides which copies get
// ! `requiresOilType: true`. Spec 06 seeded "Engine Oil"; bikelog_app spec 43 refers to
// ! "Engine Oil Change". Match both rather than hardcoding either, and report what was
// ! actually found so the dry run settles it.
const isOilChangeName = (name: string) => {
  const n = name.trim().toLowerCase();
  return n === "engine oil" || n === "engine oil change";
};

const chunked = <T>(rows: T[], size = CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
};

type OriginalMt = {
  id: string;
  name: string;
  defaultIntervalKm: number | null;
  defaultIntervalDays: number | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type OriginalOil = {
  id: string;
  name: string;
  suggestedIntervalKm: number;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
};

// ---------------------------------------------------------------------------
// Phase 0 — preconditions. Runs in every mode, dry run included.
// ---------------------------------------------------------------------------

async function assertMigrationState() {
  // ! `information_schema.columns.table_name`/`is_nullable` are Postgres type `name`
  // ! / `yes_or_no`, not `text`, and the PrismaNeon adapter cannot deserialize either —
  // ! it fails with "Failed to deserialize column of type 'name'". Same for
  // ! `pg_indexes.indexname`. Every identifier column read here must be cast to ::text.
  const cols = await prisma.$queryRaw<
    { table_name: string; is_nullable: string }[]
  >`
    SELECT table_name::text AS table_name, is_nullable::text AS is_nullable
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND column_name = 'ownerId'
       AND table_name IN ('maintenance_types', 'engine_oil_types')`;

  if (cols.length < 2) {
    throw new Error(
      `ABORT: migration A (catalog_add_owner) is not applied — found ${cols.length}/2 "ownerId" columns. Run \`yarn db:migrate\` first.`,
    );
  }
  const notNull = cols.filter((c) => c.is_nullable === "NO");
  if (notNull.length) {
    throw new Error(
      `ABORT: migration C (catalog_owner_not_null) is already applied on ${notNull
        .map((c) => c.table_name)
        .join(", ")}. The backfill must run between A and C.`,
    );
  }

  const idx = await prisma.$queryRaw<{ indexname: string }[]>`
    SELECT indexname::text AS indexname FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname IN (
         'maintenance_types_ownerId_name_key',
         'engine_oil_types_ownerId_name_key',
         'maintenance_types_name_key',
         'engine_oil_types_name_key'
       )`;
  const present = new Set(idx.map((r) => r.indexname));
  const missingComposite = [
    "maintenance_types_ownerId_name_key",
    "engine_oil_types_ownerId_name_key",
  ].filter((n) => !present.has(n));
  const lingeringGlobal = ["maintenance_types_name_key", "engine_oil_types_name_key"].filter(
    (n) => present.has(n),
  );
  if (missingComposite.length || lingeringGlobal.length) {
    throw new Error(
      `ABORT: index swap incomplete. Missing composite unique: [${missingComposite.join(
        ", ",
      )}]. Lingering global unique: [${lingeringGlobal.join(", ")}].`,
    );
  }

  console.log(
    "Preconditions:   migration A applied · composite unique present · global name unique absent   OK",
  );
}

// ! H6: `where: { ownerId: null }` does not typecheck once PR2's schema makes `ownerId`
// ! required, and this one script must survive both schema states. Read the unowned ids
// ! through raw SQL, then address the rows by `id in (...)` everywhere downstream.
async function loadUnownedIds() {
  const mt = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM maintenance_types WHERE "ownerId" IS NULL`;
  const oil = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM engine_oil_types WHERE "ownerId" IS NULL`;
  return { mtIds: mt.map((r) => r.id), oilIds: oil.map((r) => r.id) };
}

// ! H4: between migration A and this run, the global name unique is gone and the composite
// ! one cannot fire (every ownerId is NULL, and Postgres unique indexes are NULLS DISTINCT),
// ! so the still-deployed old code can create a duplicate unowned name. Never guess which
// ! to keep — abort with the list and let a human decide.
function assertNoDuplicateNames(
  label: string,
  rows: { id: string; name: string }[],
) {
  const seen = new Map<string, string[]>();
  for (const r of rows) {
    const key = r.name;
    seen.set(key, [...(seen.get(key) ?? []), r.id]);
  }
  const dupes = [...seen.entries()].filter(([, ids]) => ids.length > 1);
  if (dupes.length) {
    throw new Error(
      `ABORT: duplicate unowned names in ${label} — resolve by hand, do not re-run blindly:\n${dupes
        .map(([name, ids]) => `  "${name}" -> ${ids.join(", ")}`)
        .join("\n")}`,
    );
  }
}

async function main() {
  console.log(`Spec 46 catalog owner backfill — mode: ${mode.toUpperCase()}\n`);

  await assertMigrationState();

  const users = await prisma.user.findMany({
    select: { id: true, email: true, isDeleted: true },
  });
  const liveUserIds = users.filter((u) => !u.isDeleted).map((u) => u.id);
  console.log(
    `Users:           ${users.length} total (${liveUserIds.length} live, ${
      users.length - liveUserIds.length
    } soft-deleted)`,
  );

  const { mtIds: unownedMtIds, oilIds: unownedOilIds } = await loadUnownedIds();

  const originalMts = (await prisma.maintenanceType.findMany({
    where: { id: { in: unownedMtIds } },
    select: {
      id: true,
      name: true,
      defaultIntervalKm: true,
      defaultIntervalDays: true,
      isDeleted: true,
      createdAt: true,
      updatedAt: true,
    },
  })) as OriginalMt[];

  const originalOils = (await prisma.engineOilType.findMany({
    where: { id: { in: unownedOilIds } },
    select: {
      id: true,
      name: true,
      suggestedIntervalKm: true,
      isDeleted: true,
      createdAt: true,
      updatedAt: true,
    },
  })) as OriginalOil[];

  assertNoDuplicateNames("maintenance_types", originalMts);
  assertNoDuplicateNames("engine_oil_types", originalOils);

  console.log(
    `Originals:       maintenance_types ${originalMts.length} (${
      originalMts.filter((r) => !r.isDeleted).length
    } live, ${originalMts.filter((r) => r.isDeleted).length} deleted) · engine_oil_types ${
      originalOils.length
    } (${originalOils.filter((r) => !r.isDeleted).length} live, ${
      originalOils.filter((r) => r.isDeleted).length
    } deleted)`,
  );

  const oilChangeRows = originalMts.filter((r) => isOilChangeName(r.name));
  console.log(
    `requiresOilType: ${
      oilChangeRows.length
        ? oilChangeRows.map((r) => `"${r.name}"`).join(", ")
        : "<no oil-change row found — H7: the clients' oil-type dropdown is already dead>"
    }`,
  );

  // -------------------------------------------------------------------------
  // Phase 1 — referencing owners.
  // ! No `isDeleted` filters anywhere in this phase. Lossless means a soft-deleted log on
  // ! a soft-deleted bike of a soft-deleted user still counts.
  // -------------------------------------------------------------------------
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

  const mtRefOwners = new Map<string, Set<string>>();
  for (const r of mtRefs) {
    const set = mtRefOwners.get(r.maintenanceTypeId) ?? new Set<string>();
    set.add(r.bike.ownerId);
    mtRefOwners.set(r.maintenanceTypeId, set);
  }
  const oilRefOwners = new Map<string, Set<string>>();
  for (const r of oilRefs) {
    const key = r.oilTypeId as string;
    const set = oilRefOwners.get(key) ?? new Set<string>();
    set.add(r.bike.ownerId);
    oilRefOwners.set(key, set);
  }

  console.log(
    `Log references:  maintenance_types ${mtRefs.length} logs / ${mtRefOwners.size} ids · engine_oil_types ${oilRefs.length} logs / ${oilRefOwners.size} ids`,
  );

  // -------------------------------------------------------------------------
  // Phase 2 — target sets and owned copies.
  // -------------------------------------------------------------------------
  const targetsFor = (
    row: { id: string; isDeleted: boolean },
    refOwners: Map<string, Set<string>>,
  ): string[] => {
    const refs = [...(refOwners.get(row.id) ?? new Set<string>())];
    // A soft-deleted original follows its logs only — never copied to everyone.
    if (row.isDeleted) return [...new Set(refs)];
    // A live original goes to everyone, PLUS any soft-deleted user whose logs reference
    // it. That union is a refinement of the confirmed decision (§C phase 2): without it,
    // a soft-deleted user's logs point at an original that phase 4 then deletes —
    // silently, for oil types.
    return [...new Set([...liveUserIds, ...refs])];
  };

  const mtPlan = originalMts.flatMap((row) =>
    targetsFor(row, mtRefOwners).map((ownerId) => ({ row, ownerId })),
  );
  const oilPlan = originalOils.flatMap((row) =>
    targetsFor(row, oilRefOwners).map((ownerId) => ({ row, ownerId })),
  );

  console.log(
    `Target copies:   maintenance_types ${mtPlan.length} · engine_oil_types ${oilPlan.length}`,
  );

  // `${oldId}|${ownerId}` -> new copy id
  const idMap = new Map<string, string>();
  let mtCreated = 0;
  let mtSkipped = 0;
  let oilCreated = 0;
  let oilSkipped = 0;

  if (mode === "apply") {
    for (const batch of chunked(mtPlan)) {
      await Promise.all(
        batch.map(async ({ row, ownerId }) => {
          const existing = await prisma.maintenanceType.findUnique({
            where: { ownerId_name: { ownerId, name: row.name } },
            select: { id: true },
          });
          if (existing) {
            mtSkipped++;
            idMap.set(`${row.id}|${ownerId}`, existing.id);
            return;
          }
          const created = await prisma.maintenanceType.create({
            data: {
              // ! Ids are freshly minted per copy, per this repo's load-bearing
              // ! app-generated-id convention. NEVER reuse an original's id for a copy:
              // ! the originals are about to be deleted, and reuse would make the
              // ! (oldId, ownerId) -> newId mapping ambiguous on re-run.
              id: generateObjectId(),
              ownerId,
              name: row.name,
              defaultIntervalKm: row.defaultIntervalKm,
              defaultIntervalDays: row.defaultIntervalDays,
              requiresOilType: isOilChangeName(row.name),
              isDeleted: row.isDeleted, // decision: deleted stays deleted
              createdAt: row.createdAt, // honest history
              updatedAt: row.updatedAt,
            },
            select: { id: true },
          });
          mtCreated++;
          idMap.set(`${row.id}|${ownerId}`, created.id);
        }),
      );
    }

    for (const batch of chunked(oilPlan)) {
      await Promise.all(
        batch.map(async ({ row, ownerId }) => {
          const existing = await prisma.engineOilType.findUnique({
            where: { ownerId_name: { ownerId, name: row.name } },
            select: { id: true },
          });
          if (existing) {
            oilSkipped++;
            idMap.set(`${row.id}|${ownerId}`, existing.id);
            return;
          }
          const created = await prisma.engineOilType.create({
            data: {
              id: generateObjectId(),
              ownerId,
              name: row.name,
              suggestedIntervalKm: row.suggestedIntervalKm,
              isDeleted: row.isDeleted,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            },
            select: { id: true },
          });
          oilCreated++;
          idMap.set(`${row.id}|${ownerId}`, created.id);
        }),
      );
    }

    // ! A find-then-create pair rather than `upsert({ ..., update: {} })`, which is what
    // ! §C phase 2 sketched. The two are equivalent in effect here — and the empty
    // ! `update` is DELIBERATE, not the flaw spec 42 called out in the deleted seed
    // ! scripts. For a seed, never reconciling an existing row was a defect. For an
    // ! idempotent backfill it is required: a second run must not revert an edit the user
    // ! made to their own copy after the first run. Spelling it out as find-then-create
    // ! makes the created/skipped counts reportable, which a no-op upsert cannot be.
  } else {
    console.log(
      `(${mode} mode: no copies written. Pass --apply to create them.)`,
    );
  }

  console.log(
    `Copies created:  ${mtCreated} / ${oilCreated}      already present (skipped): ${mtSkipped} / ${oilSkipped}`,
  );

  // -------------------------------------------------------------------------
  // Phase 3 — re-point the logs.
  // -------------------------------------------------------------------------
  let mtRepointed = 0;
  let mtAlready = 0;
  let oilRepointed = 0;
  let oilAlready = 0;

  if (mode === "apply") {
    for (const batch of chunked(mtRefs)) {
      await Promise.all(
        batch.map(async (ref) => {
          const newId = idMap.get(`${ref.maintenanceTypeId}|${ref.bike.ownerId}`);
          if (!newId) {
            // structurally impossible — phase 1 fed the target set. Loud, never silent.
            throw new Error(
              `No owned copy for type ${ref.maintenanceTypeId} / owner ${ref.bike.ownerId} (log ${ref.id})`,
            );
          }
          if (ref.maintenanceTypeId === newId) {
            mtAlready++;
            return;
          }
          await prisma.maintenanceLog.update({
            where: { id: ref.id },
            data: { maintenanceTypeId: newId },
          });
          mtRepointed++;
        }),
      );
    }

    for (const batch of chunked(oilRefs)) {
      await Promise.all(
        batch.map(async (ref) => {
          const oldId = ref.oilTypeId as string;
          const newId = idMap.get(`${oldId}|${ref.bike.ownerId}`);
          if (!newId) {
            throw new Error(
              `No owned copy for oil type ${oldId} / owner ${ref.bike.ownerId} (log ${ref.id})`,
            );
          }
          if (oldId === newId) {
            oilAlready++;
            return;
          }
          // ! Writes `{ oilTypeId: newId }` only — never null. See H1.
          await prisma.maintenanceLog.update({
            where: { id: ref.id },
            data: { oilTypeId: newId },
          });
          oilRepointed++;
        }),
      );
    }
  }

  console.log(
    `Logs re-pointed: ${mtRepointed} / ${oilRepointed}      already correct (skipped): ${mtAlready} / ${oilAlready}`,
  );

  // -------------------------------------------------------------------------
  // Phase 4 — `--finalize` only.
  // -------------------------------------------------------------------------
  if (mode === "finalize") {
    const deleted = await prisma.$transaction(
      async (tx) => {
        // ! CRITICAL. maintenance_logs_oilTypeId_fkey is ON DELETE SET NULL (init
        // ! migration L262). Deleting a still-referenced engine_oil_types row does NOT
        // ! raise P2003 — it silently nulls the log's oilTypeId. This assertion is the
        // ! only thing between a missed re-point and permanent, unrecoverable loss. The
        // ! maintenanceTypeId FK is RESTRICT and protects itself; this one does not.
        // ! See spec 46 §0 H1.
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

        const mtDel = await tx.maintenanceType.deleteMany({
          where: { id: { in: unownedMtIds } },
        });
        const oilDel = await tx.engineOilType.deleteMany({
          where: { id: { in: unownedOilIds } },
        });
        return { mt: mtDel.count, oil: oilDel.count };
      },
      // the pooled DATABASE_URL times interactive transactions out at 5s
      { timeout: 30_000, maxWait: 10_000 },
    );
    console.log(
      `Originals deleted: maintenance_types ${deleted.mt} · engine_oil_types ${deleted.oil}`,
    );
  } else {
    console.log(
      `Unowned rows remaining: ${unownedMtIds.length} / ${unownedOilIds.length}    <- --finalize deletes these`,
    );
  }

  console.log(`\nDone (${mode}).`);
}

main()
  .catch((e) => {
    console.error(`\n${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
