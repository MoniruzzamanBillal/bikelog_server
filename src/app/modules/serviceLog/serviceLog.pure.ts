import { generateObjectId } from "../../util/generateObjectId";
import { TServiceItem, TServiceStatusSummary } from "./serviceLog.interface";

// Pure, DB-free helpers for the Service Log module — split out from serviceLog.utils (which
// imports the Prisma client) so the Vitest suite can exercise them without a Neon branch
// (spec 66's DB-free rule). serviceLog.utils re-exports everything here.

export const DAY_MS = 1000 * 60 * 60 * 24;

// ! Same 14-day window the maintenance DATE reminders use, so a service due date and a
// ! maintenance due date surface on the banner on the same schedule. The warranty's fuller
// ! "X of 5 / void risk" picture is the /status endpoint's job, not the banner's.
export const SERVICE_UPCOMING_DAYS = 14;

// ! item costs are JSON numbers, not Decimal columns — round here so a 300.1 + 0.2 kind of
// ! drift never reaches the spending total, which mixes this sum with Decimal-derived Numbers.
export const round2 = (n: number): number => Math.round(n * 100) / 100;

// Σ of every item's cost, treating a missing/invalid cost as 0.
export const sumItemCosts = (items?: TServiceItem[] | null): number => {
  if (!items?.length) return 0;
  const total = items.reduce(
    (sum, item) =>
      sum + (Number.isFinite(Number(item?.cost)) ? Number(item.cost) : 0),
    0,
  );
  return round2(total);
};

// One past however many warranty services already exist for the bike. Does not clamp — a 6th
// reads as #6 (a deliberate "more than the plan's five" signal), the 1..5 bound is a
// validation concern.
export const nextWarrantyNumber = (existingWarrantyCount: number): number =>
  existingWarrantyCount + 1;

// `status` is derived from whether the visit has happened (a serviceDate was recorded),
// never read from the client.
export const deriveStatus = (
  serviceDate?: Date | null,
): "upcoming" | "completed" => (serviceDate ? "completed" : "upcoming");

// A dated, still-upcoming service is overdue once its due date is in the past.
export const dueState = (dueDate: Date, now: Date): "overdue" | "upcoming" =>
  dueDate.getTime() < now.getTime() ? "overdue" : "upcoming";

// Give every item/recommendation a stable id (generate one for any entry sent without it),
// preserving an id the client already holds.
export const withGeneratedIds = <T extends { id?: string }>(
  entries?: T[] | null,
): (T & { id: string })[] | undefined => {
  if (!entries) return undefined;
  return entries.map((entry) => ({
    ...entry,
    id: entry?.id ?? generateObjectId(),
  }));
};

type WarrantySummaryRow = {
  serviceKind: "warranty" | "regular";
  status: "upcoming" | "completed";
  warrantyNumber: number | null;
  dueDate: Date | null;
};

// Warranty progress over all live service rows. `nextWarranty`/`nextService` are the earliest
// upcoming dated rows (warranty-only, and any-kind); void risk is any upcoming warranty
// service already past its due date.
export const summarizeWarranty = (
  rows: WarrantySummaryRow[],
  now: Date,
): TServiceStatusSummary => {
  const warrantyRows = rows.filter((r) => r.serviceKind === "warranty");
  const warrantyCompleted = warrantyRows.filter(
    (r) => r.status === "completed",
  ).length;

  const upcomingDated = rows
    .filter((r) => r.status === "upcoming" && r.dueDate != null)
    .sort(
      (a, b) => (a.dueDate as Date).getTime() - (b.dueDate as Date).getTime(),
    );

  const upcomingWarranty = upcomingDated.filter(
    (r) => r.serviceKind === "warranty",
  );

  const summary: TServiceStatusSummary = {
    warrantyTotal: 5,
    warrantyCompleted,
    warrantyLogged: warrantyRows.length,
    warrantyVoidRisk: upcomingWarranty.some(
      (r) => dueState(r.dueDate as Date, now) === "overdue",
    ),
  };

  const firstService = upcomingDated[0];
  if (firstService) {
    summary.nextService = {
      dueDate: firstService.dueDate as Date,
      status: dueState(firstService.dueDate as Date, now),
    };
  }

  const firstWarranty = upcomingWarranty[0];
  if (firstWarranty) {
    summary.nextWarranty = {
      number: firstWarranty.warrantyNumber,
      dueDate: firstWarranty.dueDate as Date,
      status: dueState(firstWarranty.dueDate as Date, now),
    };
  }

  return summary;
};

// The shape every reminder consumer already renders (maintenanceLog.service.ts's inline
// reminder type): a subset with the four required fields plus the date pair. Structurally
// assignable to that array's element type, so pushing these needs no client change.
export type TServiceReminder = {
  maintenanceType: { _id: string; name: string };
  lastServiceDate: Date;
  lastOdometerReading: number;
  nextDueDate: Date;
  daysRemaining: number;
  status: "overdue" | "upcoming";
};

export const daysUntil = (date: Date): number =>
  Math.ceil((date.getTime() - Date.now()) / DAY_MS);
