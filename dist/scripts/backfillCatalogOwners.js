"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
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
const prisma_1 = require("../app/lib/prisma");
const generateObjectId_1 = require("../app/util/generateObjectId");
const mode = process.argv.includes("--finalize")
    ? "finalize"
    : process.argv.includes("--apply")
        ? "apply"
        : "dry";
const CHUNK = 50;
// ! H7: the oil-change row's real production name decides which copies get
// ! `requiresOilType: true`. Spec 06 seeded "Engine Oil"; bikelog_app spec 43 refers to
// ! "Engine Oil Change". Match both rather than hardcoding either, and report what was
// ! actually found so the dry run settles it.
const isOilChangeName = (name) => {
    const n = name.trim().toLowerCase();
    return n === "engine oil" || n === "engine oil change";
};
const chunked = (rows, size = CHUNK) => {
    const out = [];
    for (let i = 0; i < rows.length; i += size)
        out.push(rows.slice(i, i + size));
    return out;
};
// ---------------------------------------------------------------------------
// Phase 0 — preconditions. Runs in every mode, dry run included.
// ---------------------------------------------------------------------------
function assertMigrationState() {
    return __awaiter(this, void 0, void 0, function* () {
        // ! `information_schema.columns.table_name`/`is_nullable` are Postgres type `name`
        // ! / `yes_or_no`, not `text`, and the PrismaNeon adapter cannot deserialize either —
        // ! it fails with "Failed to deserialize column of type 'name'". Same for
        // ! `pg_indexes.indexname`. Every identifier column read here must be cast to ::text.
        const cols = yield prisma_1.prisma.$queryRaw `
    SELECT table_name::text AS table_name, is_nullable::text AS is_nullable
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND column_name = 'ownerId'
       AND table_name IN ('maintenance_types', 'engine_oil_types')`;
        if (cols.length < 2) {
            throw new Error(`ABORT: migration A (catalog_add_owner) is not applied — found ${cols.length}/2 "ownerId" columns. Run \`yarn db:migrate\` first.`);
        }
        const notNull = cols.filter((c) => c.is_nullable === "NO");
        if (notNull.length) {
            throw new Error(`ABORT: migration C (catalog_owner_not_null) is already applied on ${notNull
                .map((c) => c.table_name)
                .join(", ")}. The backfill must run between A and C.`);
        }
        const idx = yield prisma_1.prisma.$queryRaw `
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
        const lingeringGlobal = ["maintenance_types_name_key", "engine_oil_types_name_key"].filter((n) => present.has(n));
        if (missingComposite.length || lingeringGlobal.length) {
            throw new Error(`ABORT: index swap incomplete. Missing composite unique: [${missingComposite.join(", ")}]. Lingering global unique: [${lingeringGlobal.join(", ")}].`);
        }
        console.log("Preconditions:   migration A applied · composite unique present · global name unique absent   OK");
    });
}
// ! H6: `where: { ownerId: null }` does not typecheck once PR2's schema makes `ownerId`
// ! required, and this one script must survive both schema states. Read the unowned ids
// ! through raw SQL, then address the rows by `id in (...)` everywhere downstream.
function loadUnownedIds() {
    return __awaiter(this, void 0, void 0, function* () {
        const mt = yield prisma_1.prisma.$queryRaw `
    SELECT id FROM maintenance_types WHERE "ownerId" IS NULL`;
        const oil = yield prisma_1.prisma.$queryRaw `
    SELECT id FROM engine_oil_types WHERE "ownerId" IS NULL`;
        return { mtIds: mt.map((r) => r.id), oilIds: oil.map((r) => r.id) };
    });
}
// ! H4: between migration A and this run, the global name unique is gone and the composite
// ! one cannot fire (every ownerId is NULL, and Postgres unique indexes are NULLS DISTINCT),
// ! so the still-deployed old code can create a duplicate unowned name. Never guess which
// ! to keep — abort with the list and let a human decide.
function assertNoDuplicateNames(label, rows) {
    var _a;
    const seen = new Map();
    for (const r of rows) {
        const key = r.name;
        seen.set(key, [...((_a = seen.get(key)) !== null && _a !== void 0 ? _a : []), r.id]);
    }
    const dupes = [...seen.entries()].filter(([, ids]) => ids.length > 1);
    if (dupes.length) {
        throw new Error(`ABORT: duplicate unowned names in ${label} — resolve by hand, do not re-run blindly:\n${dupes
            .map(([name, ids]) => `  "${name}" -> ${ids.join(", ")}`)
            .join("\n")}`);
    }
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        console.log(`Spec 46 catalog owner backfill — mode: ${mode.toUpperCase()}\n`);
        yield assertMigrationState();
        const users = yield prisma_1.prisma.user.findMany({
            select: { id: true, email: true, isDeleted: true },
        });
        const liveUserIds = users.filter((u) => !u.isDeleted).map((u) => u.id);
        console.log(`Users:           ${users.length} total (${liveUserIds.length} live, ${users.length - liveUserIds.length} soft-deleted)`);
        const { mtIds: unownedMtIds, oilIds: unownedOilIds } = yield loadUnownedIds();
        const originalMts = (yield prisma_1.prisma.maintenanceType.findMany({
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
        }));
        const originalOils = (yield prisma_1.prisma.engineOilType.findMany({
            where: { id: { in: unownedOilIds } },
            select: {
                id: true,
                name: true,
                suggestedIntervalKm: true,
                isDeleted: true,
                createdAt: true,
                updatedAt: true,
            },
        }));
        assertNoDuplicateNames("maintenance_types", originalMts);
        assertNoDuplicateNames("engine_oil_types", originalOils);
        console.log(`Originals:       maintenance_types ${originalMts.length} (${originalMts.filter((r) => !r.isDeleted).length} live, ${originalMts.filter((r) => r.isDeleted).length} deleted) · engine_oil_types ${originalOils.length} (${originalOils.filter((r) => !r.isDeleted).length} live, ${originalOils.filter((r) => r.isDeleted).length} deleted)`);
        const oilChangeRows = originalMts.filter((r) => isOilChangeName(r.name));
        console.log(`requiresOilType: ${oilChangeRows.length
            ? oilChangeRows.map((r) => `"${r.name}"`).join(", ")
            : "<no oil-change row found — H7: the clients' oil-type dropdown is already dead>"}`);
        // -------------------------------------------------------------------------
        // Phase 1 — referencing owners.
        // ! No `isDeleted` filters anywhere in this phase. Lossless means a soft-deleted log on
        // ! a soft-deleted bike of a soft-deleted user still counts.
        // -------------------------------------------------------------------------
        const mtRefs = yield prisma_1.prisma.maintenanceLog.findMany({
            where: { maintenanceTypeId: { in: unownedMtIds } },
            select: {
                id: true,
                maintenanceTypeId: true,
                bike: { select: { ownerId: true } },
            },
        });
        const oilRefs = yield prisma_1.prisma.maintenanceLog.findMany({
            // ! `in` matches only non-null oilTypeId rows, so no code path below can ever
            // ! WRITE a null oilTypeId. That is the invariant that keeps H1 from firing.
            where: { oilTypeId: { in: unownedOilIds } },
            select: { id: true, oilTypeId: true, bike: { select: { ownerId: true } } },
        });
        const mtRefOwners = new Map();
        for (const r of mtRefs) {
            const set = (_a = mtRefOwners.get(r.maintenanceTypeId)) !== null && _a !== void 0 ? _a : new Set();
            set.add(r.bike.ownerId);
            mtRefOwners.set(r.maintenanceTypeId, set);
        }
        const oilRefOwners = new Map();
        for (const r of oilRefs) {
            const key = r.oilTypeId;
            const set = (_b = oilRefOwners.get(key)) !== null && _b !== void 0 ? _b : new Set();
            set.add(r.bike.ownerId);
            oilRefOwners.set(key, set);
        }
        console.log(`Log references:  maintenance_types ${mtRefs.length} logs / ${mtRefOwners.size} ids · engine_oil_types ${oilRefs.length} logs / ${oilRefOwners.size} ids`);
        // -------------------------------------------------------------------------
        // Phase 2 — target sets and owned copies.
        // -------------------------------------------------------------------------
        const targetsFor = (row, refOwners) => {
            var _a;
            const refs = [...((_a = refOwners.get(row.id)) !== null && _a !== void 0 ? _a : new Set())];
            // A soft-deleted original follows its logs only — never copied to everyone.
            if (row.isDeleted)
                return [...new Set(refs)];
            // A live original goes to everyone, PLUS any soft-deleted user whose logs reference
            // it. That union is a refinement of the confirmed decision (§C phase 2): without it,
            // a soft-deleted user's logs point at an original that phase 4 then deletes —
            // silently, for oil types.
            return [...new Set([...liveUserIds, ...refs])];
        };
        const mtPlan = originalMts.flatMap((row) => targetsFor(row, mtRefOwners).map((ownerId) => ({ row, ownerId })));
        const oilPlan = originalOils.flatMap((row) => targetsFor(row, oilRefOwners).map((ownerId) => ({ row, ownerId })));
        console.log(`Target copies:   maintenance_types ${mtPlan.length} · engine_oil_types ${oilPlan.length}`);
        // `${oldId}|${ownerId}` -> new copy id
        const idMap = new Map();
        let mtCreated = 0;
        let mtSkipped = 0;
        let oilCreated = 0;
        let oilSkipped = 0;
        if (mode === "apply") {
            for (const batch of chunked(mtPlan)) {
                yield Promise.all(batch.map((_a) => __awaiter(this, [_a], void 0, function* ({ row, ownerId }) {
                    const existing = yield prisma_1.prisma.maintenanceType.findUnique({
                        where: { ownerId_name: { ownerId, name: row.name } },
                        select: { id: true },
                    });
                    if (existing) {
                        mtSkipped++;
                        idMap.set(`${row.id}|${ownerId}`, existing.id);
                        return;
                    }
                    const created = yield prisma_1.prisma.maintenanceType.create({
                        data: {
                            // ! Ids are freshly minted per copy, per this repo's load-bearing
                            // ! app-generated-id convention. NEVER reuse an original's id for a copy:
                            // ! the originals are about to be deleted, and reuse would make the
                            // ! (oldId, ownerId) -> newId mapping ambiguous on re-run.
                            id: (0, generateObjectId_1.generateObjectId)(),
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
                })));
            }
            for (const batch of chunked(oilPlan)) {
                yield Promise.all(batch.map((_a) => __awaiter(this, [_a], void 0, function* ({ row, ownerId }) {
                    const existing = yield prisma_1.prisma.engineOilType.findUnique({
                        where: { ownerId_name: { ownerId, name: row.name } },
                        select: { id: true },
                    });
                    if (existing) {
                        oilSkipped++;
                        idMap.set(`${row.id}|${ownerId}`, existing.id);
                        return;
                    }
                    const created = yield prisma_1.prisma.engineOilType.create({
                        data: {
                            id: (0, generateObjectId_1.generateObjectId)(),
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
                })));
            }
            // ! A find-then-create pair rather than `upsert({ ..., update: {} })`, which is what
            // ! §C phase 2 sketched. The two are equivalent in effect here — and the empty
            // ! `update` is DELIBERATE, not the flaw spec 42 called out in the deleted seed
            // ! scripts. For a seed, never reconciling an existing row was a defect. For an
            // ! idempotent backfill it is required: a second run must not revert an edit the user
            // ! made to their own copy after the first run. Spelling it out as find-then-create
            // ! makes the created/skipped counts reportable, which a no-op upsert cannot be.
        }
        else {
            console.log(`(${mode} mode: no copies written. Pass --apply to create them.)`);
        }
        console.log(`Copies created:  ${mtCreated} / ${oilCreated}      already present (skipped): ${mtSkipped} / ${oilSkipped}`);
        // -------------------------------------------------------------------------
        // Phase 3 — re-point the logs.
        // -------------------------------------------------------------------------
        let mtRepointed = 0;
        let mtAlready = 0;
        let oilRepointed = 0;
        let oilAlready = 0;
        if (mode === "apply") {
            for (const batch of chunked(mtRefs)) {
                yield Promise.all(batch.map((ref) => __awaiter(this, void 0, void 0, function* () {
                    const newId = idMap.get(`${ref.maintenanceTypeId}|${ref.bike.ownerId}`);
                    if (!newId) {
                        // structurally impossible — phase 1 fed the target set. Loud, never silent.
                        throw new Error(`No owned copy for type ${ref.maintenanceTypeId} / owner ${ref.bike.ownerId} (log ${ref.id})`);
                    }
                    if (ref.maintenanceTypeId === newId) {
                        mtAlready++;
                        return;
                    }
                    yield prisma_1.prisma.maintenanceLog.update({
                        where: { id: ref.id },
                        data: { maintenanceTypeId: newId },
                    });
                    mtRepointed++;
                })));
            }
            for (const batch of chunked(oilRefs)) {
                yield Promise.all(batch.map((ref) => __awaiter(this, void 0, void 0, function* () {
                    const oldId = ref.oilTypeId;
                    const newId = idMap.get(`${oldId}|${ref.bike.ownerId}`);
                    if (!newId) {
                        throw new Error(`No owned copy for oil type ${oldId} / owner ${ref.bike.ownerId} (log ${ref.id})`);
                    }
                    if (oldId === newId) {
                        oilAlready++;
                        return;
                    }
                    // ! Writes `{ oilTypeId: newId }` only — never null. See H1.
                    yield prisma_1.prisma.maintenanceLog.update({
                        where: { id: ref.id },
                        data: { oilTypeId: newId },
                    });
                    oilRepointed++;
                })));
            }
        }
        console.log(`Logs re-pointed: ${mtRepointed} / ${oilRepointed}      already correct (skipped): ${mtAlready} / ${oilAlready}`);
        // -------------------------------------------------------------------------
        // Phase 4 — `--finalize` only.
        // -------------------------------------------------------------------------
        if (mode === "finalize") {
            const deleted = yield prisma_1.prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                // ! CRITICAL. maintenance_logs_oilTypeId_fkey is ON DELETE SET NULL (init
                // ! migration L262). Deleting a still-referenced engine_oil_types row does NOT
                // ! raise P2003 — it silently nulls the log's oilTypeId. This assertion is the
                // ! only thing between a missed re-point and permanent, unrecoverable loss. The
                // ! maintenanceTypeId FK is RESTRICT and protects itself; this one does not.
                // ! See spec 46 §0 H1.
                const strayMt = yield tx.maintenanceLog.count({
                    where: { maintenanceTypeId: { in: unownedMtIds } },
                });
                const strayOil = yield tx.maintenanceLog.count({
                    where: { oilTypeId: { in: unownedOilIds } },
                });
                if (strayMt || strayOil) {
                    throw new Error(`ABORT: ${strayMt} maintenance + ${strayOil} oil references remain. Re-run --apply.`);
                }
                const mtDel = yield tx.maintenanceType.deleteMany({
                    where: { id: { in: unownedMtIds } },
                });
                const oilDel = yield tx.engineOilType.deleteMany({
                    where: { id: { in: unownedOilIds } },
                });
                return { mt: mtDel.count, oil: oilDel.count };
            }), 
            // the pooled DATABASE_URL times interactive transactions out at 5s
            { timeout: 30000, maxWait: 10000 });
            console.log(`Originals deleted: maintenance_types ${deleted.mt} · engine_oil_types ${deleted.oil}`);
        }
        else {
            console.log(`Unowned rows remaining: ${unownedMtIds.length} / ${unownedOilIds.length}    <- --finalize deletes these`);
        }
        console.log(`\nDone (${mode}).`);
    });
}
main()
    .catch((e) => {
    console.error(`\n${e.message}`);
    process.exitCode = 1;
})
    .finally(() => __awaiter(void 0, void 0, void 0, function* () {
    yield prisma_1.prisma.$disconnect();
}));
