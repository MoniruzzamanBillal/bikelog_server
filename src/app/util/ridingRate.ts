import { prisma } from "../lib/prisma";

// Spec 54 §D6: extracted verbatim out of `maintenanceLog.service.ts`, where spec 52 put it.
// That spec's D7 said to move the helper somewhere shared "only when a second consumer
// appears" — `engineOilLog`'s status endpoint is that second consumer. This is a PURE
// extraction: same constants, same arithmetic, byte-identical behaviour for reminders.
//
// ! Spec 52 §B: distance-based reminders used to appear a flat 50 km before they were
// ! due, which at ~43 km/day is barely a day of riding — the reminder arrived after the
// ! decision it was meant to inform. The threshold is now a projected number of days,
// ! which needs a km/day figure for the bike. `PROJECTED_UPCOMING_DAYS` is the alert
// ! horizon (how early a reminder appears); `PROJECTION_WINDOW_DAYS` is the measurement
// ! window (how far back we look to learn the rate). They are different knobs — D1.
export const DAY_MS = 24 * 60 * 60 * 1000;

const PROJECTION_WINDOW_DAYS = 28; // D1: 4 weeks of history to average over
const MIN_PROJECTION_SPAN_DAYS = 14; // below this, one odd week dominates — refuse
const MIN_PROJECTION_DISTANCE_KM = 100; // also catches odometer corrections (negative distance)
export const KM_UPCOMING_FALLBACK = 50; // H6: the pre-spec-52 rule, kept for bikes with no history
export const PROJECTED_UPCOMING_DAYS = 10; // D2: the alert horizon, ~430 km at ~43 km/day

// ! Spec 56: which window a rate was measured over. `computeKmPerDay` below is always
// ! "recent"; `computeFallbackKmPerDay`'s two attempts are "history" and "lifetime". It
// ! exists so the oil-status payload can hedge the wording of a date it derived from a
// ! coarser figure — nothing branches on it.
export type TRateSource = "recent" | "history" | "lifetime";

export type TRidingRate = {
  kmPerDay: number;
  spanDays: number;
  distanceKm: number;
  source?: TRateSource;
};

// ! D5: the rate comes from `FuelLog` rows directly, not `MileageRecord` — mileage records
// ! only close on full-tank fills, so they cover an unknown subset of the riding. Every
// ! fuel log carries `date` + `odometerReading`, which is the whole input. One indexed
// ! query (`@@index([bikeId])`) per request, not per reminder.
export const computeKmPerDay = async (
  bikeId: string,
): Promise<TRidingRate | null> => {
  const since = new Date(Date.now() - PROJECTION_WINDOW_DAYS * DAY_MS);

  const logs = await prisma.fuelLog.findMany({
    where: { bikeId, isDeleted: false, date: { gte: since } },
    orderBy: { date: "asc" },
    select: { date: true, odometerReading: true },
  });

  if (logs.length < 2) return null;

  const latest = logs[logs.length - 1];

  // ! H3: of all candidate anchors, take the one whose span to `latest` is nearest a whole
  // ! number of weeks, so the rider's 5-or-6-day week cannot skew the average. Iterating
  // ! oldest-first with a strict `<` means a tie resolves to the LONGER span — more data,
  // ! less noise — without needing a second comparison.
  // ! Spec 52a: `since` is computed at request time, so a log dated exactly 28 days back
  // ! falls outside `gte: since` and is never read — a span of exactly 28 days is
  // ! unreachable, and the reachable span is capped at `28 − age of the newest log`.
  let anchor: (typeof logs)[number] | null = null;
  let bestOffWeek = Infinity;

  for (const candidate of logs.slice(0, -1)) {
    const spanDays =
      (latest.date.getTime() - candidate.date.getTime()) / DAY_MS;
    if (spanDays < MIN_PROJECTION_SPAN_DAYS) continue;

    const remainder = spanDays % 7;
    const offWeek = Math.min(remainder, 7 - remainder);

    if (offWeek < bestOffWeek) {
      bestOffWeek = offWeek;
      anchor = candidate;
    }
  }

  if (!anchor) return null;

  // ! H2: the divisor is the span between the two logs actually used, NEVER
  // ! PROJECTION_WINDOW_DAYS — the newest log is days old and that gap is not riding we know about.
  const spanDays = (latest.date.getTime() - anchor.date.getTime()) / DAY_MS;
  const distanceKm = latest.odometerReading - anchor.odometerReading;

  if (distanceKm < MIN_PROJECTION_DISTANCE_KM) return null;

  return {
    kmPerDay: distanceKm / spanDays,
    spanDays,
    distanceKm,
    source: "recent",
  };
};

// ! Spec 56 §B. `computeKmPerDay` above is deliberately strict — two fuel logs inside a
// ! 28-day window, ≥14 days apart, ≥100 km between them — because it decides whether a
// ! reminder fires, and a reminder fired off three days of data is worse than no reminder.
// ! That strictness is why the oil card had no date to show for the developer's own bike:
// ! miss any one of those conditions and `projectedDueDate` is simply omitted.
// !
// ! This is the DATE-ONLY fallback, and the split matters: it never feeds `evaluateOilDue`,
// ! so no reminder threshold and no `status` value anywhere changes because of it (H2). It
// ! only lets the status endpoint answer "around when?" from a coarser figure, tagged with
// ! `source` so the client can say so.
//
// Two attempts, in order of how well they describe recent riding:
//   1. "history"  — the oldest and newest live fuel logs, whatever window they span.
//   2. "lifetime" — the bike's own odometer since purchase, which needs no fuel log at all.
const MAX_FALLBACK_STALENESS_DAYS = 365;

export const computeFallbackKmPerDay = async (bike: {
  id: string;
  initialOdometer: number;
  currentOdometer: number;
  purchaseDate: Date;
}): Promise<TRidingRate | null> => {
  const [oldest, newest] = await Promise.all([
    prisma.fuelLog.findFirst({
      where: { bikeId: bike.id, isDeleted: false },
      orderBy: { date: "asc" },
      select: { date: true, odometerReading: true },
    }),
    prisma.fuelLog.findFirst({
      where: { bikeId: bike.id, isDeleted: false },
      orderBy: { date: "desc" },
      select: { date: true, odometerReading: true },
    }),
  ]);

  if (oldest && newest) {
    const spanDays = (newest.date.getTime() - oldest.date.getTime()) / DAY_MS;
    const distanceKm = newest.odometerReading - oldest.odometerReading;
    // ! A bike parked for two years would otherwise project off the riding it did before
    // ! it was parked, which reads as a confident date and is pure fiction.
    const ageDays = (Date.now() - newest.date.getTime()) / DAY_MS;

    if (
      spanDays >= MIN_PROJECTION_SPAN_DAYS &&
      distanceKm >= MIN_PROJECTION_DISTANCE_KM &&
      ageDays <= MAX_FALLBACK_STALENESS_DAYS
    ) {
      return {
        kmPerDay: distanceKm / spanDays,
        spanDays,
        distanceKm,
        source: "history",
      };
    }
  }

  // ! `currentOdometer` is raised by every log and by Settings' manual update (spec 44), so
  // ! this works for a rider who logs maintenance but barely logs fuel. It is an average
  // ! over the whole time they have owned the bike, so it is the bluntest of the three —
  // ! hence last, and hence tagged.
  const spanDays = (Date.now() - bike.purchaseDate.getTime()) / DAY_MS;
  const distanceKm = bike.currentOdometer - bike.initialOdometer;

  if (
    spanDays >= MIN_PROJECTION_SPAN_DAYS &&
    distanceKm >= MIN_PROJECTION_DISTANCE_KM
  ) {
    return {
      kmPerDay: distanceKm / spanDays,
      spanDays,
      distanceKm,
      source: "lifetime",
    };
  }

  return null;
};
