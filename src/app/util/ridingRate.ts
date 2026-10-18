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

export type TRidingRate = {
  kmPerDay: number;
  spanDays: number;
  distanceKm: number;
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

  return { kmPerDay: distanceKm / spanDays, spanDays, distanceKm };
};
