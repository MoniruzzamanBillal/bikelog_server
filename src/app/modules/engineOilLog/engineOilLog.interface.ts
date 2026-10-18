// Spec 54 §D10: the fuel-log parity set plus the two oil-specific fields that had nowhere
// to live in `maintenance_logs`. `oilType` is the catalog id as the client submits it; the
// Prisma column is `oilTypeId` (same remap `maintenanceLog` does).
//
// ! `nextDueOdometer` is deliberately absent — it is server-derived from
// ! `odometerReading + intervalKmUsed` and never accepted over the wire (D3).
export type TEngineOilLog = {
  oilType?: string;
  odometerReading: number;
  intervalKmUsed?: number;
  quantityLiters?: number;
  oilFilterChanged?: boolean;
  cost: number;
  changeDate?: Date;
  serviceCenter?: string | null;
  notes?: string | null;
};

// §D — the shape of `GET /bikes/:bikeId/engine-oil-logs/status`. Every optional field is
// omitted (not `null`) in the three non-error states the spec enumerates, so a client can
// test for presence rather than guess at a null's meaning.
export type TEngineOilStatus = {
  status: "ok" | "upcoming" | "overdue" | "unknown";
  currentOdometer: number;
  lastChange: {
    _id: string;
    changeDate: Date;
    odometerReading: number;
    oilType: { _id: string; name: string } | null;
    intervalKm?: number;
    nextDueOdometer?: number;
    oilFilterChanged: boolean;
  } | null;
  kmSinceChange?: number;
  // ! signed, deliberately unlike getRemindersFromDB's clamped Math.max(0, …) — a new
  // ! endpoint has no back-compat to preserve, so it returns the honest overshoot (§D)
  kmRemaining?: number;
  percentUsed?: number;
  projectedDaysRemaining?: number;
  projectedDueDate?: Date;
  kmPerDay?: number;
  rateBasis?: { spanDays: number; distanceKm: number };
};
