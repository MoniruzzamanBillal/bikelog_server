import { prisma } from "../../lib/prisma";
import { TServiceRecommendation } from "./serviceLog.interface";
import {
  daysUntil,
  dueState,
  SERVICE_UPCOMING_DAYS,
  TServiceReminder,
} from "./serviceLog.pure";

// Re-export every pure helper so existing import sites (`./serviceLog.utils`) keep working;
// the pure ones live in serviceLog.pure (no Prisma import) so the unit suite can reach them.
export * from "./serviceLog.pure";

// ! Lives here (prisma-touching util) exactly like engineOilLog.utils' findLatestEngineOilLog,
// ! so getRemindersFromDB (maintenanceLog.service.ts §E) re-sources service reminders without
// ! the due arithmetic drifting between two files. Emits:
// !  - the EARLIEST upcoming service row that has a due date, and
// !  - every PENDING recommendation (done !== true) that has a target date,
// ! each overdue if past / upcoming if within 14 days, filtered to that window.
export const getServiceRemindersFromDB = async (
  bikeId: string,
  currentOdometer: number,
): Promise<TServiceReminder[]> => {
  const now = new Date();
  const reminders: TServiceReminder[] = [];

  const upcomingRows = await prisma.serviceLog.findMany({
    where: {
      bikeId,
      isDeleted: false,
      status: "upcoming",
      dueDate: { not: null },
    },
    orderBy: { dueDate: "asc" },
  });

  const nextRow = upcomingRows[0];
  if (nextRow?.dueDate) {
    const daysRemaining = daysUntil(nextRow.dueDate);
    const state = dueState(nextRow.dueDate, now);
    if (state === "overdue" || daysRemaining <= SERVICE_UPCOMING_DAYS) {
      reminders.push({
        maintenanceType: {
          _id: nextRow.id,
          name:
            nextRow.serviceKind === "warranty"
              ? `Warranty service #${nextRow.warrantyNumber ?? ""}`.trim()
              : "Next service",
        },
        lastServiceDate: nextRow.dueDate,
        lastOdometerReading: currentOdometer,
        nextDueDate: nextRow.dueDate,
        daysRemaining,
        status: state,
      });
    }
  }

  // Pending recommendations with a target date, across every live service row. (No JSON
  // not-null filter — Prisma's JSON filters don't take a plain null, and a per-bike service
  // list is small enough to scan in JS, which the loop below does anyway.)
  const rowsWithRecs = await prisma.serviceLog.findMany({
    where: {
      bikeId,
      isDeleted: false,
    },
    orderBy: { createdAt: "desc" },
  });

  for (const row of rowsWithRecs) {
    const recs = (row.recommendations as TServiceRecommendation[] | null) ?? [];
    for (const rec of recs) {
      if (rec?.done === true || rec?.targetDate == null) continue;
      const target = new Date(rec.targetDate);
      if (Number.isNaN(target.getTime())) continue;

      const daysRemaining = daysUntil(target);
      const state = dueState(target, now);
      if (state !== "overdue" && daysRemaining > SERVICE_UPCOMING_DAYS)
        continue;

      reminders.push({
        maintenanceType: {
          _id: rec.id ?? `${row.id}-rec`,
          name: rec.text,
        },
        lastServiceDate: row.serviceDate ?? row.createdAt,
        lastOdometerReading: currentOdometer,
        nextDueDate: target,
        daysRemaining,
        status: state,
      });
    }
  }

  return reminders;
};
