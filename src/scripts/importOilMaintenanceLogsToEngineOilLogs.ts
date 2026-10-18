/**
 * Spec 54 §H — carries the historical engine oil changes out of `maintenance_logs` and
 * into the new `engine_oil_logs` table. The developer's one hard constraint on this spec
 * is that nothing is lost, so this script COPIES, LINKS, and only then HIDES: it never
 * moves a row and never hard-deletes one.
 *
 * Usage:
 *   # dry run — the default, writes nothing
 *   npx ts-node --transpile-only src/scripts/importOilMaintenanceLogsToEngineOilLogs.ts
 *
 *   # one bike first, if you want a cautious look
 *   npx ts-node --transpile-only src/scripts/importOilMaintenanceLogsToEngineOilLogs.ts --bike=<bikeId>
 *
 *   # copy the rows. The source maintenance logs stay LIVE.
 *   npx ts-node --transpile-only src/scripts/importOilMaintenanceLogsToEngineOilLogs.ts --apply
 *
 *   # soft-delete the source logs. Reversible with one UPDATE (printed below).
 *   npx ts-node --transpile-only src/scripts/importOilMaintenanceLogsToEngineOilLogs.ts --finalize
 *
 * `--finalize` is a separate invocation on purpose, exactly as spec 46's backfill made it:
 * the step that changes what the user sees must never be a side effect of the copy step.
 *
 * ! §0 H3 — RUN THE TWO STEPS IN ONE SITTING. Between --apply and --finalize every
 * ! historical oil change is counted TWICE in spending (the summary total, the category
 * ! breakdown, the trend chart and the PDF export all read `computeSpendingForRange`,
 * ! which now sums both tables). That is tolerable only because it is a read-only,
 * ! minutes-long window — not something to leave overnight, and all of it before
 * ! `bikelog_client-web-` spec 33 ships, so nobody is looking at the doubled numbers.
 *
 * ! §0 H8 — an imported row's receiptImage is a COPY OF THE REFERENCE, not of the file.
 * ! Until --finalize runs, one Cloudinary asset has two owners and
 * ! `DELETE /engine-oil-logs/:id/image` would break the maintenance log's thumbnail too.
 * ! Finalize is what leaves exactly one live owner.
 *
 * Preconditions: migration `20261018071500_add_engine_oil_logs` applied (phase 0 asserts
 * it). This script cannot run against local Postgres — the PrismaNeon adapter needs a real
 * Neon host (spec 31b). Deliberately introspects NOTHING: `information_schema` /
 * `pg_catalog` identifier columns are Postgres type `name`/`yes_or_no`, which that adapter
 * cannot deserialize ("Failed to deserialize column of type 'name'") — the defect that
 * made spec 46's backfill abort on its first query in every mode after passing both
 * `yarn build` and `yarn lint`.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../app/lib/prisma";
import { generateObjectId } from "../app/util/generateObjectId";

type Mode = "dry" | "apply" | "finalize";

const mode: Mode = process.argv.includes("--finalize")
  ? "finalize"
  : process.argv.includes("--apply")
    ? "apply"
    : "dry";

const bikeArg = process.argv.find((a) => a.startsWith("--bike="));
const bikeFilter = bikeArg ? bikeArg.slice("--bike=".length) : undefined;

const CHUNK = 50;

const chunked = <T>(rows: T[], size = CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
};

const money = (value: Prisma.Decimal | number) => Number(value).toFixed(2);

// ---------------------------------------------------------------------------
// Phase 0 — preconditions. Runs in every mode, dry run included.
// ---------------------------------------------------------------------------
async function assertTableExists() {
  try {
    await prisma.engineOilLog.count();
  } catch {
    throw new Error(
      "ABORT: could not read engine_oil_logs — migration 20261018071500_add_engine_oil_logs is probably not applied. Run `yarn db:migrate` first (and see spec 54 §0 H9: spec 53's migration is pending too, so deploy applies BOTH).",
    );
  }
}

async function main() {
  console.log(
    `Spec 54 engine oil log import — mode: ${mode.toUpperCase()}${
      bikeFilter ? `   (bike ${bikeFilter} only)` : ""
    }\n`,
  );

  await assertTableExists();

  // -------------------------------------------------------------------------
  // Phase 1 — selection.
  // ! The OR matters. The first arm catches logs whose maintenance type has since had
  // ! requiresOilType turned off; the second catches oil changes entered before an oil
  // ! type was ever chosen (H7 — maintenanceLog.oilType is optional, so such rows
  // ! legitimately exist in production and are exactly the ones that must not be lost).
  // -------------------------------------------------------------------------
  const sources = await prisma.maintenanceLog.findMany({
    where: {
      isDeleted: false,
      ...(bikeFilter ? { bikeId: bikeFilter } : {}),
      OR: [
        { oilTypeId: { not: null } },
        { maintenanceType: { requiresOilType: true } },
      ],
    },
    orderBy: [{ serviceDate: "asc" }, { createdAt: "asc" }],
    include: {
      maintenanceType: { select: { name: true, requiresOilType: true } },
      oilType: { select: { name: true, suggestedIntervalKm: true } },
    },
  });

  const withType = sources.filter((s) => s.oilTypeId !== null);
  const sourceTotal = sources.reduce((sum, s) => sum + Number(s.cost), 0);

  console.log(
    `Selected:        ${sources.length} live maintenance logs (${withType.length} with an oil type, ${
      sources.length - withType.length
    } without — H7)`,
  );
  console.log(`Source cost sum: ${money(sourceTotal)}`);

  const alreadyImported = await prisma.engineOilLog.findMany({
    where: { importedFromMaintenanceLogId: { in: sources.map((s) => s.id) } },
    select: { id: true, importedFromMaintenanceLogId: true },
  });
  const importedIds = new Set(
    alreadyImported.map((r) => r.importedFromMaintenanceLogId as string),
  );
  const pending = sources.filter((s) => !importedIds.has(s.id));

  console.log(
    `Already copied:  ${importedIds.size} (skipped)      still to copy: ${pending.length}`,
  );

  // -------------------------------------------------------------------------
  // Phase 2 — `--apply`: one engine_oil_logs row per selected log.
  // Idempotent by the unique `importedFromMaintenanceLogId`, so a second --apply writes
  // nothing and reports the skips rather than failing.
  // -------------------------------------------------------------------------
  let created = 0;
  let noInterval = 0;

  if (mode === "apply") {
    for (const batch of chunked(pending)) {
      await Promise.all(
        batch.map(async (source) => {
          // ! the interval is resolved ONCE here and frozen on the row (H6/D3): the log's
          // ! own intervalKmUsed when it had one, else the oil type's current suggestion,
          // ! else null. A null-interval row has no due point and never drives the
          // ! forecast — §D's third state, which exists for exactly these rows.
          const intervalKmUsed =
            source.intervalKmUsed ?? source.oilType?.suggestedIntervalKm ?? null;
          if (intervalKmUsed === null) noInterval++;

          await prisma.engineOilLog.create({
            data: {
              // ! a fresh id per copy — this repo's app-generated-id convention. The
              // ! source id travels in importedFromMaintenanceLogId instead, which is what
              // ! makes a re-run a no-op and tells --finalize exactly what to hide.
              id: generateObjectId(),
              bikeId: source.bikeId,
              oilTypeId: source.oilTypeId,
              odometerReading: source.odometerReading,
              intervalKmUsed,
              // ! recomputed from the resolved interval rather than copied, so the two can
              // ! never disagree on an imported row
              nextDueOdometer:
                intervalKmUsed === null
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
              receiptImage:
                source.serviceImage === null
                  ? undefined
                  : (source.serviceImage as Prisma.InputJsonValue),
              importedFromMaintenanceLogId: source.id,
            },
          });
          created++;
        }),
      );
    }
  } else {
    console.log(
      `(${mode} mode: no rows copied. Pass --apply to copy them.)`,
    );
  }

  if (mode === "apply") {
    console.log(
      `Rows copied:     ${created}      of which no resolvable interval: ${noInterval}`,
    );
  }

  // -------------------------------------------------------------------------
  // Verification — printed in every mode. Run these by eye too (spec 54 §H).
  // -------------------------------------------------------------------------
  const importedRows = await prisma.engineOilLog.findMany({
    where: {
      importedFromMaintenanceLogId: { not: null },
      ...(bikeFilter ? { bikeId: bikeFilter } : {}),
    },
    select: { cost: true, importedFromMaintenanceLogId: true },
  });
  const importedTotal = importedRows.reduce(
    (sum, r) => sum + Number(r.cost),
    0,
  );

  console.log(
    `\nVerify:  selected ${sources.length} vs imported ${importedRows.length}   ${
      sources.length === importedRows.length ? "MATCH" : "MISMATCH"
    }`,
  );
  console.log(
    `Verify:  source cost ${money(sourceTotal)} vs imported cost ${money(importedTotal)}   ${
      money(sourceTotal) === money(importedTotal) ? "MATCH" : "MISMATCH"
    }`,
  );

  // -------------------------------------------------------------------------
  // Phase 3 — `--finalize`: soft-delete exactly the source logs that were copied.
  // Nothing else, and no hard delete anywhere.
  // -------------------------------------------------------------------------
  if (mode === "finalize") {
    const sourceIds = importedRows
      .map((r) => r.importedFromMaintenanceLogId as string)
      .filter(Boolean);

    if (sources.length !== importedRows.length) {
      throw new Error(
        `ABORT: ${sources.length} selected but ${importedRows.length} imported — re-run --apply before finalizing, or some oil changes would be hidden with no copy to show in their place.`,
      );
    }

    const hidden = await prisma.maintenanceLog.updateMany({
      where: { id: { in: sourceIds }, isDeleted: false },
      data: { isDeleted: true },
    });

    console.log(`\nSource logs soft-deleted: ${hidden.count}`);
    console.log(
      "Reversal (one statement, nothing was destroyed):\n" +
        '  UPDATE maintenance_logs SET "isDeleted" = false\n' +
        '   WHERE id IN (SELECT "importedFromMaintenanceLogId" FROM engine_oil_logs WHERE "importedFromMaintenanceLogId" IS NOT NULL);',
    );
  } else {
    const stillLive = await prisma.maintenanceLog.count({
      where: {
        isDeleted: false,
        id: {
          in: importedRows
            .map((r) => r.importedFromMaintenanceLogId as string)
            .filter(Boolean),
        },
      },
    });
    console.log(
      `\nSource logs still live: ${stillLive}    <- --finalize soft-deletes these (and until it runs, oil is double-counted in spending — H3)`,
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
