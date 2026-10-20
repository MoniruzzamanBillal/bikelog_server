import { TRateSource } from "../../util/ridingRate";

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
  // ! Spec 56: present in the overdue state too, where it is the date the oil is estimated
  // ! to have PASSED its due point — i.e. in the past. `projectedDaysRemaining` is still
  // ! omitted when overdue (it would have to go negative, and `bikelog_client-web-` prints
  // ! it verbatim in an audit line), so `overdueDays` below carries that figure instead.
  projectedDueDate?: Date;
  // ! Spec 56: positive number of days the oil is estimated to be past due. Only ever set
  // ! together with `status: "overdue"` and a usable rate.
  overdueDays?: number;
  kmPerDay?: number;
  rateBasis?: { spanDays: number; distanceKm: number; source?: TRateSource };
  // ! Spec 56 §C — the PROVISIONAL forecast for a change that carries no interval of its
  // ! own (one of §H's imported rows, or a change logged before spec 54 seeded the field).
  // ! Nothing here is stored and nothing here is authoritative: it is derived from the oil
  // ! type's CURRENT `suggestedIntervalKm`, so it moves if the catalog is edited — which is
  // ! exactly why it is kept out of the top-level fields spec 54 H6 deliberately froze on
  // ! the row. Present only when `lastChange.intervalKm` is absent and the log still
  // ! resolves an oil type. A client must label whatever it renders from this as an estimate.
  estimate?: {
    basis: "oilTypeSuggestion";
    status: "ok" | "upcoming" | "overdue";
    intervalKm: number;
    nextDueOdometer: number;
    kmRemaining: number;
    percentUsed: number;
    projectedDaysRemaining?: number;
    projectedDueDate?: Date;
    overdueDays?: number;
  };
};
