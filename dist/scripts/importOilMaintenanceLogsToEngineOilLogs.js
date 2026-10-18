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
const prisma_1 = require("../app/lib/prisma");
const generateObjectId_1 = require("../app/util/generateObjectId");
const mode = process.argv.includes("--finalize")
    ? "finalize"
    : process.argv.includes("--apply")
        ? "apply"
        : "dry";
const bikeArg = process.argv.find((a) => a.startsWith("--bike="));
const bikeFilter = bikeArg ? bikeArg.slice("--bike=".length) : undefined;
const CHUNK = 50;
const chunked = (rows, size = CHUNK) => {
    const out = [];
    for (let i = 0; i < rows.length; i += size)
        out.push(rows.slice(i, i + size));
    return out;
};
const money = (value) => Number(value).toFixed(2);
// ---------------------------------------------------------------------------
// Phase 0 — preconditions. Runs in every mode, dry run included.
// ---------------------------------------------------------------------------
function assertTableExists() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield prisma_1.prisma.engineOilLog.count();
        }
        catch (_a) {
            throw new Error("ABORT: could not read engine_oil_logs — migration 20261018071500_add_engine_oil_logs is probably not applied. Run `yarn db:migrate` first (and see spec 54 §0 H9: spec 53's migration is pending too, so deploy applies BOTH).");
        }
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`Spec 54 engine oil log import — mode: ${mode.toUpperCase()}${bikeFilter ? `   (bike ${bikeFilter} only)` : ""}\n`);
        yield assertTableExists();
        // -------------------------------------------------------------------------
        // Phase 1 — selection.
        // ! The OR matters. The first arm catches logs whose maintenance type has since had
        // ! requiresOilType turned off; the second catches oil changes entered before an oil
        // ! type was ever chosen (H7 — maintenanceLog.oilType is optional, so such rows
        // ! legitimately exist in production and are exactly the ones that must not be lost).
        // -------------------------------------------------------------------------
        const sources = yield prisma_1.prisma.maintenanceLog.findMany({
            where: Object.assign(Object.assign({ isDeleted: false }, (bikeFilter ? { bikeId: bikeFilter } : {})), { OR: [
                    { oilTypeId: { not: null } },
                    { maintenanceType: { requiresOilType: true } },
                ] }),
            orderBy: [{ serviceDate: "asc" }, { createdAt: "asc" }],
            include: {
                maintenanceType: { select: { name: true, requiresOilType: true } },
                oilType: { select: { name: true, suggestedIntervalKm: true } },
            },
        });
        const withType = sources.filter((s) => s.oilTypeId !== null);
        const sourceTotal = sources.reduce((sum, s) => sum + Number(s.cost), 0);
        console.log(`Selected:        ${sources.length} live maintenance logs (${withType.length} with an oil type, ${sources.length - withType.length} without — H7)`);
        console.log(`Source cost sum: ${money(sourceTotal)}`);
        const alreadyImported = yield prisma_1.prisma.engineOilLog.findMany({
            where: { importedFromMaintenanceLogId: { in: sources.map((s) => s.id) } },
            select: { id: true, importedFromMaintenanceLogId: true },
        });
        const importedIds = new Set(alreadyImported.map((r) => r.importedFromMaintenanceLogId));
        const pending = sources.filter((s) => !importedIds.has(s.id));
        console.log(`Already copied:  ${importedIds.size} (skipped)      still to copy: ${pending.length}`);
        // -------------------------------------------------------------------------
        // Phase 2 — `--apply`: one engine_oil_logs row per selected log.
        // Idempotent by the unique `importedFromMaintenanceLogId`, so a second --apply writes
        // nothing and reports the skips rather than failing.
        // -------------------------------------------------------------------------
        let created = 0;
        let noInterval = 0;
        if (mode === "apply") {
            for (const batch of chunked(pending)) {
                yield Promise.all(batch.map((source) => __awaiter(this, void 0, void 0, function* () {
                    var _a, _b, _c;
                    // ! the interval is resolved ONCE here and frozen on the row (H6/D3): the log's
                    // ! own intervalKmUsed when it had one, else the oil type's current suggestion,
                    // ! else null. A null-interval row has no due point and never drives the
                    // ! forecast — §D's third state, which exists for exactly these rows.
                    const intervalKmUsed = (_c = (_a = source.intervalKmUsed) !== null && _a !== void 0 ? _a : (_b = source.oilType) === null || _b === void 0 ? void 0 : _b.suggestedIntervalKm) !== null && _c !== void 0 ? _c : null;
                    if (intervalKmUsed === null)
                        noInterval++;
                    yield prisma_1.prisma.engineOilLog.create({
                        data: {
                            // ! a fresh id per copy — this repo's app-generated-id convention. The
                            // ! source id travels in importedFromMaintenanceLogId instead, which is what
                            // ! makes a re-run a no-op and tells --finalize exactly what to hide.
                            id: (0, generateObjectId_1.generateObjectId)(),
                            bikeId: source.bikeId,
                            oilTypeId: source.oilTypeId,
                            odometerReading: source.odometerReading,
                            intervalKmUsed,
                            // ! recomputed from the resolved interval rather than copied, so the two can
                            // ! never disagree on an imported row
                            nextDueOdometer: intervalKmUsed === null
                                ? null
                                : source.odometerReading + intervalKmUsed,
                            // ! unknowable from a maintenance log; the developer can edit any row afterwards
                            quantityLiters: null,
                            oilFilterChanged: false,
                            cost: source.cost,
                            changeDate: source.serviceDate,
                            serviceCenter: source.serviceCenter,
                            notes: source.notes,
                            // ! H8: the REFERENCE is copied, never the file. Never re-upload here.
                            receiptImage: source.serviceImage === null
                                ? undefined
                                : source.serviceImage,
                            importedFromMaintenanceLogId: source.id,
                        },
                    });
                    created++;
                })));
            }
        }
        else {
            console.log(`(${mode} mode: no rows copied. Pass --apply to copy them.)`);
        }
        if (mode === "apply") {
            console.log(`Rows copied:     ${created}      of which no resolvable interval: ${noInterval}`);
        }
        // -------------------------------------------------------------------------
        // Verification — printed in every mode. Run these by eye too (spec 54 §H).
        // -------------------------------------------------------------------------
        const importedRows = yield prisma_1.prisma.engineOilLog.findMany({
            where: Object.assign({ importedFromMaintenanceLogId: { not: null } }, (bikeFilter ? { bikeId: bikeFilter } : {})),
            select: { cost: true, importedFromMaintenanceLogId: true },
        });
        const importedTotal = importedRows.reduce((sum, r) => sum + Number(r.cost), 0);
        console.log(`\nVerify:  selected ${sources.length} vs imported ${importedRows.length}   ${sources.length === importedRows.length ? "MATCH" : "MISMATCH"}`);
        console.log(`Verify:  source cost ${money(sourceTotal)} vs imported cost ${money(importedTotal)}   ${money(sourceTotal) === money(importedTotal) ? "MATCH" : "MISMATCH"}`);
        // -------------------------------------------------------------------------
        // Phase 3 — `--finalize`: soft-delete exactly the source logs that were copied.
        // Nothing else, and no hard delete anywhere.
        // -------------------------------------------------------------------------
        if (mode === "finalize") {
            const sourceIds = importedRows
                .map((r) => r.importedFromMaintenanceLogId)
                .filter(Boolean);
            if (sources.length !== importedRows.length) {
                throw new Error(`ABORT: ${sources.length} selected but ${importedRows.length} imported — re-run --apply before finalizing, or some oil changes would be hidden with no copy to show in their place.`);
            }
            const hidden = yield prisma_1.prisma.maintenanceLog.updateMany({
                where: { id: { in: sourceIds }, isDeleted: false },
                data: { isDeleted: true },
            });
            console.log(`\nSource logs soft-deleted: ${hidden.count}`);
            console.log("Reversal (one statement, nothing was destroyed):\n" +
                '  UPDATE maintenance_logs SET "isDeleted" = false\n' +
                '   WHERE id IN (SELECT "importedFromMaintenanceLogId" FROM engine_oil_logs WHERE "importedFromMaintenanceLogId" IS NOT NULL);');
        }
        else {
            const stillLive = yield prisma_1.prisma.maintenanceLog.count({
                where: {
                    isDeleted: false,
                    id: {
                        in: importedRows
                            .map((r) => r.importedFromMaintenanceLogId)
                            .filter(Boolean),
                    },
                },
            });
            console.log(`\nSource logs still live: ${stillLive}    <- --finalize soft-deletes these (and until it runs, oil is double-counted in spending — H3)`);
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
