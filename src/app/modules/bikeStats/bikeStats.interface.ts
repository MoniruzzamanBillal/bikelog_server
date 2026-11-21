// Spec 68: the finished scalars the mobile/web bike "stat strip" renders. Lean
// computed numbers, NOT a re-wrap of the four raw payloads it replaces — the wire
// payload is small and no client does any arithmetic on it.
export type TBikeStatStrip = {
  avgMileageKmPerLiter: number | null;
  monthSpending: number; // for targetMonth (or the server's current month)
  lifetimeSpending: number;
  costPerKm: number | null; // null when (currentOdometer - initialOdometer) <= 0
  oil: {
    kmSinceChange: number | null; // null ⇔ no oil change on record
    percentUsed: number | null; // null ⇔ no oil change on record
  };
};
