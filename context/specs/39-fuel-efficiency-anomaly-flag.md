# 39: Fuel-Efficiency Anomaly Flag

## Status

✅ Complete — implemented and verified 2026-09-21. See `progress-tracker.md` Recent Activity for the full verification pass.

## Goal

Per direct user request, for day-to-day usage: `MileageRecord` already stores `mileageKmPerLiter` for every closed full-tank-to-full-tank period, but nothing compares one period to the user's own recent history. Add a computed flag to the existing mileage-history response so a >15% drop vs. the rolling average can be surfaced to the user (client work is a separate spec, `bikelog_app` spec 37) — turning already-collected data into an early warning for a developing mechanical issue.

## Context

- `MileageRecord` Prisma model already stores `mileageKmPerLiter` per period (computed once at full-tank-close time, not just derivable) alongside `periodStartDate`/`periodEndDate`/`distanceKm`/`litersConsumed`.
- `GET /bikes/:bikeId/mileage` (`mileageRecord.service.ts`'s `getMileageRecordsFromDB`) already returns `{ exactRecords, approximate }`, `exactRecords` sorted `periodEndDate desc`. Current implementation:
  ```ts
  const ROLLING_AVERAGE_WINDOW = 10;
  const getMileageRecordsFromDB = async (bikeId: string) => {
    const exactRecords = await prisma.mileageRecord.findMany({ ... });
    // ...separate "approximate" calc over the last 10 fuel logs of any type — a fallback for bikes with too little full-tank data, unrelated to this spec
    return { exactRecords: exactRecords.map(toApiShape), approximate };
  };
  ```
- None of `/mileage/monthly`, `/mileage/yearly`, `/mileage/lifetime`, `/mileage/trend` (all built on the shared `computeMileageForRange` helper) compute km/L directly — they only return raw distance/liters sums, and are the wrong basis for this feature. `exactRecords` from the `/mileage` (history) endpoint already has per-period `mileageKmPerLiter` and is the right source.
- No rolling-average/anomaly/threshold utility exists elsewhere in this codebase for this purpose (confirmed via repo-wide grep) — this is small, self-contained, new logic, not a refactor of something existing.
- Both current `bikelog_app` consumers of `GET /bikes/:bikeId/mileage` — `components/main/FuelLog/FuelLog.tsx` and `components/main/Mileage/MileageHistoryTab.tsx` — use the identical React Query key `["mileage", "history", bikeId]`, confirmed directly in both files. Extending this endpoint's response (rather than adding a new one) means spec 37's banner can piggyback on an already-fetched query with zero extra network calls, regardless of where it's placed.
- Response-shape convention: this project already remaps Prisma's `id` → `_id` per record (`toApiShape`) — the new field is additive to the existing return object, no change to that mapping.

## Design

New pure function, colocated with `getMileageRecordsFromDB` in `mileageRecord.service.ts`, operating only on the `exactRecords` array already being fetched — no new DB query:

```ts
const MIN_PRIOR_PERIODS_FOR_ALERT = 3; // need at least 3 prior periods before ever flagging — 1-2 samples have no real baseline
const ROLLING_WINDOW_FOR_ALERT = 5; // average of the prior 5 periods, floored to whatever's available down to the minimum
const ANOMALY_DROP_THRESHOLD = 0.85; // latest < average * 0.85 == a >15% drop (strict <, the boundary itself does not flag)

type TEfficiencyAlert = {
  isAnomaly: boolean;
  latestKmPerLiter: number;
  rollingAverageKmPerLiter: number;
  percentChange: number; // negative on a drop
  periodsUsed: number;
};

const computeEfficiencyAlert = (
  exactRecords: { mileageKmPerLiter: number }[], // already sorted periodEndDate desc
): TEfficiencyAlert | null => {
  if (exactRecords.length < MIN_PRIOR_PERIODS_FOR_ALERT + 1) return null;

  const [latest, ...prior] = exactRecords;
  const windowed = prior.slice(0, ROLLING_WINDOW_FOR_ALERT);
  const rollingAverageKmPerLiter =
    windowed.reduce((sum, r) => sum + r.mileageKmPerLiter, 0) / windowed.length;
  const percentChange =
    (latest.mileageKmPerLiter - rollingAverageKmPerLiter) /
    rollingAverageKmPerLiter;

  return {
    isAnomaly:
      latest.mileageKmPerLiter <
      rollingAverageKmPerLiter * ANOMALY_DROP_THRESHOLD,
    latestKmPerLiter: latest.mileageKmPerLiter,
    rollingAverageKmPerLiter,
    percentChange,
    periodsUsed: windowed.length,
  };
};
```

Fold into the existing return:

```ts
return {
  exactRecords: exactRecords.map(toApiShape),
  approximate,
  efficiencyAlert: computeEfficiencyAlert(exactRecords),
};
```

No route/controller signature changes — `mileageRecordController.getMileageRecords` already passes this function's return value straight through via `sendResponse`.

**Why these specific constants:**

- `MIN_PRIOR_PERIODS_FOR_ALERT = 3`: a bike with only 1–2 full-tank periods has no real baseline — a single noisy fill (a partial-tank data-entry mistake, one unusual ride) would immediately read as a "drop" against a 1–2-sample "average" with zero statistical grounding. 3 prior periods (4 total including the latest) is the smallest number that lets the average absorb one outlier without being dominated by it.
- `ROLLING_WINDOW_FOR_ALERT = 5`: roughly the last 1–2 months of typical riding — recent enough that a real mechanical/tire/chain issue shows up against _recent_ behavior rather than being diluted by a lifetime average, but smooth enough (5 samples) that a single bad reading doesn't itself trigger a false alarm.
- `ANOMALY_DROP_THRESHOLD = 0.85` (15%): balances catching a real efficiency drop against normal tank-to-tank variance from traffic, load, or weather. Strict `<` means exactly 85% of the average does not flag — only a drop past it.

**Type additions**, `mileageRecord.interface.ts`:

```ts
export type TEfficiencyAlert = {
  isAnomaly: boolean;
  latestKmPerLiter: number;
  rollingAverageKmPerLiter: number;
  percentChange: number;
  periodsUsed: number;
};
```

## Implementation

- [x] `mileageRecord.service.ts` — add `MIN_PRIOR_PERIODS_FOR_ALERT`/`ROLLING_WINDOW_FOR_ALERT`/`ANOMALY_DROP_THRESHOLD` constants and `computeEfficiencyAlert`.
- [x] `mileageRecord.service.ts` — fold `efficiencyAlert: computeEfficiencyAlert(exactRecords)` into `getMileageRecordsFromDB`'s return value.
- [x] `mileageRecord.interface.ts` — add `TEfficiencyAlert`.
- [x] Confirm no other consumer of `getMileageRecordsFromDB`'s return shape breaks from the additive field — `grep`-confirmed the only other importers of `mileageRecordServices` (`notification.service.ts`, `ai.service.ts`) call `computeMileageForRange`/`getLifetimeMileageFromDB`/`getMileageTrendFromDB`, never `getMileageRecordsFromDB` itself; the controller passes its return value straight through.
- [x] `yarn build` + `yarn lint` clean (0 errors, 19 pre-existing `no-console` warnings in unrelated files — same baseline, nothing new).
- [x] `context/progress-tracker.md` — row added and flipped to Complete, Recent Activity entry added.

## Verify

Ran against a temporary local dev server (`PORT=5099`, `yarn dev`) connected to the real Neon Postgres, with a throwaway test user + bike + 7 full-tank fuel logs. Used a deliberate outlier value (P1 = 50 km/L, distinct from the rest) instead of a flat baseline so the rolling-average math and the 5-period cap/exclusion could be proven by exact arithmetic rather than eyeballing similar numbers — all values below were hand-computed in advance and matched exactly.

- [x] 3 full-tank periods only (P1=50, P2=40, P3=40 km/L) → `GET /bikes/:bikeId/mileage` → `efficiencyAlert: null` — proves the minimum-sample guard (below the 4-record minimum).
- [x] Add a 4th log (P4=40 km/L) → `efficiencyAlert` non-null: `isAnomaly: false`, `rollingAverageKmPerLiter: 43.333...` (hand-computed avg of P3/P2/P1 = 40/40/50), `latestKmPerLiter: 40`, `percentChange: -0.0769`, `periodsUsed: 3` — exact match.
- [x] Add a 5th log (P5=37 km/L, a real but sub-15% drop vs. the then-current average of 42.5) → `isAnomaly: false`, `percentChange: -0.1294` (-12.9%) — confirms a moderate drop under the threshold does not flag.
- [x] Add a 6th log (P6=30 km/L, a clear drop vs. the then-current average of 41.4) → `isAnomaly: true`, `percentChange: -0.2754` (-27.5%), `periodsUsed: 5` — confirms a real anomaly flags correctly.
- [x] Add a 7th log (P7=36 km/L) → `periodsUsed` stayed capped at `5` and `rollingAverageKmPerLiter` came back as `37.4` (= avg of P6/P5/P4/P3/P2 = 30/37/40/40/40) rather than `39.5` (what it would be if the outlier P1=50 had wrongly stayed in the window) — proves both the 5-period cap and the correct exclusion of the oldest prior record.
- [x] Confirmed `exactRecords`/`approximate` are structurally unchanged (`exactRecords[0]` keys and `approximate`'s `{mileageKmPerLiter, basedOnFuelLogCount, isEstimate}` shape both identical to pre-change) — purely additive, no regression for the two existing consumers (`FuelLog.tsx`, `MileageHistoryTab.tsx`).
- [x] `yarn build` clean, `yarn lint` at the existing warning/error baseline (0 errors, 19 pre-existing warnings).
- [x] All test fixtures (7 fuel logs, 7 mileage records, 1 bike, 1 user) deleted afterward via a throwaway in-tree script reusing the app's own Prisma client, removed immediately after running.
