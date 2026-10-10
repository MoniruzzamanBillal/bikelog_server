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
 * Spec 49 repair: raises any bike whose `currentOdometer` is below its own highest live log.
 *
 * Before spec 45 made `bumpOdometerIfHigher` atomic, concurrent fuel-log saves could leave a
 * bike's `currentOdometer` below the highest reading ever logged (DEF-01). The fix stops new
 * corruption; it never repaired rows already hit, and no API path re-derives the value.
 *
 * Expected value per live bike:
 *   GREATEST(currentOdometer, initialOdometer,
 *            MAX(live fuel_logs.odometerReading), MAX(live maintenance_logs.odometerReading))
 * The script only ever RAISES a value — a manual odometer update (spec 44) may legitimately sit
 * above every log, so lowering would destroy real data. Soft-deleted logs are ignored. Each write
 * is a conditional `updateMany` (`currentOdometer < expected`), the same atomic shape as
 * `bumpOdometerIfHigher`, so a manual update landing mid-run cannot be clobbered. Idempotent:
 * once a bike is at its expected value it is never listed or written again.
 *
 * Usage:
 *   # dry run — the default, writes nothing
 *   npx ts-node --transpile-only src/scripts/reconcileBikeOdometer.ts
 *
 *   # write the repairs
 *   npx ts-node --transpile-only src/scripts/reconcileBikeOdometer.ts --apply
 *
 * Review the dry run before applying. A bike whose `expected` is far above its other readings is
 * a bad LOG (an old typo such as 150000 for 15000), not a race victim — look at that log first.
 *
 * Connection: `src/app/lib/prisma.ts` builds the PrismaNeon adapter from `DATABASE_URL`. This
 * script cannot run against a plain local Postgres (the adapter needs a Neon host / ws proxy).
 */
/* eslint-disable no-console */
const prisma_1 = require("../app/lib/prisma");
const apply = process.argv.includes("--apply");
// ! raw SQL on purpose: one set-based read of both log tables. `::float8` keeps the PrismaNeon
// ! adapter from returning anything other than plain numbers (it has choked on un-cast types
// ! before — see spec 46's backfill)
const findBehind = () => prisma_1.prisma.$queryRaw `
    SELECT id, nickname, "current", "expected"
      FROM (
        SELECT b.id,
               b.nickname,
               b."currentOdometer"::float8 AS "current",
               GREATEST(
                 b."currentOdometer",
                 b."initialOdometer",
                 COALESCE((SELECT MAX(f."odometerReading") FROM fuel_logs f
                            WHERE f."bikeId" = b.id AND f."isDeleted" = false), 0),
                 COALESCE((SELECT MAX(m."odometerReading") FROM maintenance_logs m
                            WHERE m."bikeId" = b.id AND m."isDeleted" = false), 0)
               )::float8 AS "expected"
          FROM bikes b
         WHERE b."isDeleted" = false
      ) t
     WHERE "expected" > "current"
     ORDER BY ("expected" - "current") DESC`;
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`reconcileBikeOdometer — mode: ${apply ? "APPLY" : "dry run (nothing is written)"}\n`);
        const behind = yield findBehind();
        if (behind.length === 0) {
            console.log("No bike is behind its own logs. Nothing to do.");
            return;
        }
        console.table(behind.map((r) => ({
            bikeId: r.id,
            nickname: r.nickname,
            current: r.current,
            expected: r.expected,
            delta: r.expected - r.current,
        })));
        console.log(`${behind.length} bike(s) behind.`);
        if (!apply) {
            console.log("\nDry run — re-run with --apply to raise them.");
            return;
        }
        let written = 0;
        for (const row of behind) {
            // ! the `lt` guard makes this a conditional atomic write: if the bike moved past `expected`
            // ! since the read above (a new log, a manual update), the row simply doesn't match
            const { count } = yield prisma_1.prisma.bike.updateMany({
                where: { id: row.id, currentOdometer: { lt: row.expected } },
                data: { currentOdometer: row.expected },
            });
            written += count;
            console.log(`  ${row.id}  ${row.current} -> ${row.expected}  ${count ? "raised" : "skipped (already moved)"}`);
        }
        const stillBehind = yield findBehind();
        console.log(`\nRaised ${written} bike(s). Still behind after the run: ${stillBehind.length}`);
        if (stillBehind.length > 0)
            process.exitCode = 1;
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
