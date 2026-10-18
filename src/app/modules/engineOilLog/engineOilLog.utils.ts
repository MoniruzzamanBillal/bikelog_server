import httpStatus from "http-status";
import AppError from "../../Error/AppError";
import { prisma } from "../../lib/prisma";
import {
  KM_UPCOMING_FALLBACK,
  PROJECTED_UPCOMING_DAYS,
  TRidingRate,
} from "../../util/ridingRate";

// Spec 54 §C/§D. Lives here rather than in the service because `getRemindersFromDB`
// (§E, in maintenanceLog.service.ts) must read the newest oil log with exactly the same
// ordering and apply exactly the same due test as the status endpoint — two copies of
// either would drift apart silently.

// ! H13: clients submit `yyyy-MM-dd`, which z.coerce.date() stores as exactly
// ! 00:00:00.000Z, so two changes entered on the same day tie and Postgres leaves ties in
// ! no defined order. `createdAt` is insertion time and unique in practice, so appending
// ! it descending makes "newest" total — the same fix buildPrismaListQuery applies.
export const findLatestEngineOilLog = async (bikeId: string) => {
  return prisma.engineOilLog.findFirst({
    where: { bikeId, isDeleted: false },
    orderBy: [{ changeDate: "desc" }, { createdAt: "desc" }],
    // ! no `isDeleted` filter on the include — spec 41's rule: a historical log must still
    // ! resolve the name of a type that has since been soft-deleted
    include: { oilType: { select: { id: true, name: true } } },
  });
};

export const computeNextDueOdometer = (
  odometerReading: number,
  intervalKmUsed: number,
): number => odometerReading + intervalKmUsed;

// ! H10: the reading must sit between the newest earlier oil log's and the oldest later
// ! one's, scoped to this bike's LIVE oil logs — never compared against
// ! bike.currentOdometer, which manual updates raise and nothing lowers, and which would
// ! refuse every legitimate backdated entry (spec 26's bug, written down as DEF-12 in
// ! spec 48). Backdating is the normal first flow on this screen: the rider types in the
// ! last oil change they already made. A direct port of fuelLog.service.ts's version;
// ! same-timestamp ties count as "earlier", so entry order breaks the tie.
export const assertOilOdometerInSequence = async (
  bike: { id: string; initialOdometer: number },
  entry: { reading: number; date: Date; excludeId?: string },
) => {
  const base = {
    bikeId: bike.id,
    isDeleted: false,
    ...(entry.excludeId ? { id: { not: entry.excludeId } } : {}),
  };

  const [earlier, later] = await Promise.all([
    prisma.engineOilLog.aggregate({
      where: { ...base, changeDate: { lte: entry.date } },
      _max: { odometerReading: true },
    }),
    prisma.engineOilLog.aggregate({
      where: { ...base, changeDate: { gt: entry.date } },
      _min: { odometerReading: true },
    }),
  ]);

  const lowerBound = Math.max(
    bike.initialOdometer,
    earlier._max.odometerReading ?? bike.initialOdometer,
  );

  if (entry.reading < lowerBound) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Odometer reading (${entry.reading} km) can't be lower than the previous reading (${lowerBound} km)`,
    );
  }

  const upperBound = later._min.odometerReading;
  if (upperBound !== null && entry.reading > upperBound) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Odometer reading (${entry.reading} km) can't be higher than a later engine oil log's reading (${upperBound} km)`,
    );
  }
};

export type TOilDueEvaluation = {
  status: "ok" | "upcoming" | "overdue" | "unknown";
  kmSinceChange: number;
  // all four absent when the log carries no interval (H7's imported row)
  kmRemaining?: number;
  percentUsed?: number;
  projectedDays?: number;
};

// ! One place for the due arithmetic, shared by the status endpoint (§D) and the reminders
// ! entry (§E). The thresholds are spec 52's, imported rather than re-declared: the
// ! projected-days rule with the flat 50 km rule kept as the fallback for a bike whose
// ! fuel history cannot support a rate (spec 52 H6 — removing the fallback would silently
// ! stop producing distance alerts for a new bike forever).
export const evaluateOilDue = (
  log: { odometerReading: number; nextDueOdometer: number | null },
  currentOdometer: number,
  rate: TRidingRate | null,
): TOilDueEvaluation => {
  // ! H5: `bike.currentOdometer` only moves when something logs against the bike, so
  // ! between logs the bike has been ridden further than the stored number — "km on this
  // ! oil" is understated. Clamp at 0 rather than printing a negative distance (a
  // ! backdated change entered above the current reading).
  const kmSinceChange = Math.max(0, currentOdometer - log.odometerReading);

  if (log.nextDueOdometer === null) {
    return { status: "unknown", kmSinceChange };
  }

  const intervalKm = log.nextDueOdometer - log.odometerReading;
  const kmRemaining = log.nextDueOdometer - currentOdometer; // signed
  const percentUsed =
    intervalKm > 0 ? Math.round((kmSinceChange / intervalKm) * 100) : 0;

  if (kmRemaining <= 0) {
    return { status: "overdue", kmSinceChange, kmRemaining, percentUsed };
  }

  // ! H5 again: floor, never ceil. Both the lagging odometer and the rate's measurement
  // ! window bias the date late, and late is the one direction an oil-change estimate
  // ! must not err in. 0 is a legitimate answer ("any day now").
  const projectedDays = rate
    ? Math.max(0, Math.floor(kmRemaining / rate.kmPerDay))
    : undefined;

  const upcoming =
    projectedDays !== undefined
      ? projectedDays <= PROJECTED_UPCOMING_DAYS // 10, spec 52 D2
      : kmRemaining <= KM_UPCOMING_FALLBACK; // spec 52 H6, the old rule

  return {
    status: upcoming ? "upcoming" : "ok",
    kmSinceChange,
    kmRemaining,
    percentUsed,
    projectedDays,
  };
};
