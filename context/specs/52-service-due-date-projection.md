# 52: Service due-date projection — server half

Status: ⛔ **Not Started.** Written 2026-10-11 from `../../../new Features/02-service-due-dates.md`.
Paired with `bikelog_app` spec 53 (the display) and `bikelog_app` spec 54 (the prerequisite that makes distance reminders exist at all).
Scope: `maintenanceLog.service.ts` only — `getRemindersFromDB` and one new module-local helper. No schema change, no migration, no new endpoint, no new dependency.

**What this changes, in one line:** distance-based reminders currently appear 50 km before they are due; after this they appear ~10 projected days before they are due, and they carry the date.

---

## §0 Hazards — read before writing code

**H1 — The 50 km gate is the feature. The date is the garnish.**
`maintenanceLog.service.ts:329` reads `const kmUpcoming = !kmOverdue && kmRemaining <= 50;`. Until that distance is reached, `getRemindersFromDB` emits **nothing** for the type — the reminder is not in the array at all. So no amount of client work can project a date onto it. At ~43 km/day, 50 km is barely one day of riding: the reminder arrives after the decision it was meant to inform. Replacing that threshold is the substance of this spec; the two extra response fields are the cheap part.

**H2 — Dividing by the window length instead of the covered span biases the date LATE.**
Odometer data only advances when a log is written. If the window is 28 days but the newest fuel log is 4 days old, the real covered span is 24 days — dividing the distance by 28 understates km/day by ~14% and pushes the projected date later. **Late is the one direction a service reminder must not err in.** Always divide by the span between the two fuel logs actually used, never by the nominal window.

**H3 — A span that is not a whole number of weeks inherits the rider's weekday pattern.**
The developer rides 5 days most weeks, sometimes 6 (stated 2026-10-11). Take 60 km on each of 5 riding days: 300 km/week, a true **42.9 km per calendar day**. A 30-day span is 4 weeks + 2 days, and those 2 stray days are not neutral:

| Span    | Composition             | km/calendar day | Projection for a 2,400 km interval |
| ------- | ----------------------- | --------------- | ---------------------------------- |
| 28 days | exactly 4 weeks         | 42.9            | 56 days (correct)                  |
| 30 days | 4 weeks + 2 riding days | 44.0            | 54 days (2 early)                  |
| 30 days | 4 weeks + 2 rest days   | 40.0            | **60 days (4 late)**               |

Snapping the span to a multiple of 7 removes this bias **without the server ever learning which days the rider rides**. This is why §B picks its anchor log the way it does, and it is the single reason the window is not just "the oldest log in range".

**H4 — Per-weekday profiling is not derivable from this schema. Do not attempt it.**
A `FuelLog` records distance _between fills_; a `MileageRecord` covers a multi-day period. Nothing anywhere records which days the bike moved. So the projection **cannot** skip the rider's days off, and cannot deliberately land on a riding day. If that is ever wanted it must come from a rider-entered setting, not from history.

**H5 — `currentOdometer` is itself stale, in the same unsafe direction as H2.**
It only advances when a fuel log, a maintenance log, or the Settings odometer panel (spec 44) bumps it. Between logs the bike has been ridden further than the stored value, so `kmRemaining` is **overstated**, which pushes the date later again. H2 and H5 compound. The response is not to model it — it is to **floor** the day count (§C) and keep the "around" hedge in the client's copy (spec 53 §E). Never `Math.ceil`.

**H6 — No fuel history must not mean no reminder.**
A new bike, or one with a single fuel log, cannot support a km/day figure. If `kmRemaining <= 50` is _replaced_ rather than _supplemented_, such a bike silently stops producing distance reminders forever — a regression that no test touching a well-used bike would catch. The 50 km rule stays as the fallback whenever the projection is unavailable.

**H7 — `nextDueOdometer` only exists when `intervalKmUsed` was supplied.**
`maintenanceLog.service.ts:108-111` computes it only when `payload.intervalKmUsed !== undefined`. Services logged without an interval have no distance reminder and nothing to project — they are invisible to this entire feature. Not fixable here; `bikelog_app` spec 54 covers it, and that spec is the real prerequisite for anyone noticing this one.

**H8 — Do not feed the clamped `kmRemaining` into the projection.**
`:375` emits `Math.max(0, kmRemaining)`. Compute the projection from the raw local `kmRemaining`, before clamping, and only for `upcoming`. Overdue rows get no projection at all (decision D4).

**H9 — The threshold change is visible in `bikelog_client-web-` whether or not it is updated.**
Its `components/(main)/MaintenanceLog/RemindersBanner.tsx` carries the same `getDistanceLine` logic the app mirrors. Once this ships, that banner starts surfacing reminders ~8× earlier (50 km of warning becomes ~430 km), printing `420 km left` with no date beside it. Nothing breaks — no field is renamed, removed or reshaped — so cascade step 3 is **not** triggered and no web spec is written. It is a cosmetic lag, and the parity fix there is the same handful of lines as spec 53 §C/§D.

---

## §A Decisions

- **D1 — The measurement window is 4 weeks (28 days); the alert horizon is 10 days. These are different knobs.** The window is how far back we look to learn km/day. The horizon is how early a reminder appears. Conflating them is easy and wrong. Both numbers were **settled by the developer on 2026-10-11** — see Settled questions at the end for what was weighed.
- **D2 — 10 days for the horizon** (settled 2026-10-11). At ~43 km/day that converts 50 km of warning into **~430 km** — about 8× today's notice, and enough to book a workshop for the coming week without the banner becoming permanent furniture on a short-interval type like chain lube.
  - **Accept the asymmetry this creates, deliberately.** The date branch at `:344` still fires at `daysRemaining <= 14` and this spec does not touch it, so a calendar-due service warns two weeks out while a distance-due one warns ~10 projected days out. That is a real inconsistency in the status rule and it is the price of the shorter distance horizon; if the two should ever be unified, move the *date* rule to 10, not the projection back to 14.
- **D3 — The projection lives on the server, not the client.** The plan file's §Decisions said "start client-side"; that was written before the 50 km gate was read, and is **wrong**. The threshold is server-side, so the arithmetic that replaces it must be too. Being server-side also means the web client inherits it for free if it ever wants it.
- **D4 — Overdue gets no projection.** It is already past; the existing "past due" line is the correct and complete thing to say.
- **D5 — km/day comes from `FuelLog` rows directly, not from `MileageRecord`.** Mileage records only close on **full-tank** fills (`fuelLog.service.ts:163`), so they cover an unknown subset of riding. Every fuel log, full tank or not, carries `date` and `odometerReading` — which is the entire input. `@@index([bikeId])` already exists, so this is one indexed query per reminders request (not per reminder).
- **D6 — `kmPerDay` is returned alongside the projection.** It costs nothing, it is what makes the client able to explain itself ("based on your last 4 weeks"), and without it a wrong-looking date is undebuggable from the outside.
- **D7 — No new module.** The helper is module-local to `maintenanceLog.service.ts`. `mileageRecordServices.computeMileageForRange` is exported and tempting, but it bounds by _calendar range_ and would walk straight into H2 and H3. Move the helper somewhere shared only when a second consumer appears.

---

## §B New helper: `computeKmPerDay(bikeId)`

Module-local in `maintenanceLog.service.ts`, above `getRemindersFromDB`.

```ts
const DAY_MS = 24 * 60 * 60 * 1000;

const PROJECTION_WINDOW_DAYS = 28; // D1: 4 weeks of history to average over
const MIN_PROJECTION_SPAN_DAYS = 14; // below this, one odd week dominates — refuse
const MIN_PROJECTION_DISTANCE_KM = 100; // also catches odometer corrections (negative distance)
const KM_UPCOMING_FALLBACK = 50; // H6: the pre-spec-52 rule, kept for bikes with no history

type TRidingRate = {
  kmPerDay: number;
  spanDays: number;
  distanceKm: number;
};

const computeKmPerDay = async (bikeId: string): Promise<TRidingRate | null> => {
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
```

**One consequence of the 4-week window worth knowing before you read the loop.** With `PROJECTION_WINDOW_DAYS = 28` and `MIN_PROJECTION_SPAN_DAYS = 14`, every usable anchor sits in a **14-day band** (14–28 days old), so there are at most two near-exact-week spans to choose between (21 and 28) instead of the four an 8-week window offered. The H3 snapping still works — a rider filling up every 4–7 days has several candidates in that band — but a rider who fills rarely can now land on a span like 17 days, where `offWeek` is 3 and the weekday bias is only partly removed. That is a tolerated loss of precision, not a bug: `MIN_PROJECTION_SPAN_DAYS` must **not** be lowered to widen the band, because a sub-2-week span is exactly the "one odd week dominates" case it exists to reject.

- [ ] Constants added
- [ ] `TRidingRate` added
- [ ] `computeKmPerDay` added, with the H2 and H3 comments kept verbatim — they are the only record of why the loop exists

## §C Rewire the threshold in `getRemindersFromDB`

One call before the loop, and a changed `kmUpcoming`.

```ts
const getRemindersFromDB = async (bikeId: string, userId: string) => {
  const bike = await findOwnedBikeOrThrow(bikeId, userId);

  const logs = await prisma.maintenanceLog.findMany({ /* unchanged */ });

  // ! Once per request, not per reminder.
  const rate = await computeKmPerDay(bikeId);
```

Inside the `nextDueOdometer !== null` branch, replacing `:326-335`:

```ts
if (log.nextDueOdometer !== null) {
  kmRemaining = log.nextDueOdometer - bike.currentOdometer; // H8: raw, pre-clamp
  const kmOverdue = kmRemaining <= 0;

  if (!kmOverdue && rate) {
    // ! H5: floor, never ceil — currentOdometer lags reality, so the honest estimate is
    // ! the early one. 0 is a legitimate answer ("any day now"), negative is not.
    projectedDays = Math.max(0, Math.floor(kmRemaining / rate.kmPerDay));
  }

  const kmUpcoming =
    !kmOverdue &&
    (projectedDays !== undefined
      ? projectedDays <= PROJECTED_UPCOMING_DAYS // 10, D2
      : kmRemaining <= KM_UPCOMING_FALLBACK); // H6, the old rule

  if (kmOverdue) {
    status = "overdue";
  } else if (kmUpcoming) {
    status = "upcoming";
  }
}
```

`projectedDays` is declared beside `kmRemaining` at the top of the loop body, `let projectedDays: number | undefined;`.

- [ ] `const rate = await computeKmPerDay(bikeId)` added once, before the loop
- [ ] `PROJECTED_UPCOMING_DAYS = 10` added
- [ ] `kmUpcoming` replaced, with the fallback intact
- [ ] `projectedDays` declared per-iteration, not hoisted outside the loop (it must reset per type)

## §D Response shape — additive only

Extend the inline reminder type (both copies — the array's type at `:307-320` and the local `reminder` literal's type at `:354-363`; they are duplicated in the current code and must stay in step):

```ts
  projectedDaysRemaining?: number;
  projectedDueDate?: Date;
  kmPerDay?: number;
```

and populate them only where a projection exists:

```ts
if (log.nextDueOdometer !== null) {
  reminder.nextDueOdometer = log.nextDueOdometer;
  reminder.kmRemaining = Math.max(0, kmRemaining!);

  // ! D4: upcoming only. An overdue row is already past; a projection for it is noise.
  if (status === "upcoming" && projectedDays !== undefined && rate) {
    reminder.projectedDaysRemaining = projectedDays;
    reminder.projectedDueDate = new Date(Date.now() + projectedDays * DAY_MS);
    reminder.kmPerDay = Math.round(rate.kmPerDay * 10) / 10;
  }
}
```

Nothing is renamed, removed or retyped, so every existing consumer keeps working — that is what keeps the web client out of this (H9) and lets the app ship in either order (§E).

- [ ] Both inline types extended
- [ ] Fields populated under the `upcoming` guard only
- [ ] `kmPerDay` rounded to 1dp — a raw `42.857142857142854` in a payload is noise

## §E Deploy ordering

Forgiving, unlike the spec 46/30 rollout:

- **Server first** (ideal): the app keeps rendering exactly as today until its build lands, because it ignores unknown fields.
- **App first**: `projectedDueDate` is absent, spec 53's guard renders the distance alone. No crash, no empty string, no "Invalid Date".

So there is no gate and no runbook. The only hard requirement is that spec 53 treats both fields as optional-and-nullable (its H-A).

---

## Test plan

Needs a local server and Postman. `GET /api/bikes/:bikeId/reminders` throughout.

| #   | Scenario                                                                   | Expected                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | Bike with **no** fuel logs, service due in 30 km                           | `upcoming`, no projected fields — the H6 fallback fired                                                                                                                   |
| V2  | Bike with **one** fuel log, service due in 30 km                           | Same as V1 (`logs.length < 2` → `null`)                                                                                                                                   |
| V3  | Bike with 2 fuel logs 10 days apart                                        | No projection (`MIN_PROJECTION_SPAN_DAYS`), fallback rule applies                                                                                                         |
| V4  | Bike with logs across 28 days, service 400 km out at ~43 km/day            | `upcoming`, `projectedDaysRemaining` ≈ 9, `projectedDueDate` ≈ today + 9. Note the fixture must sit **inside** 28 days now — logs older than that are no longer read      |
| V5  | Same bike, service **2,400 km** out                                        | **Absent from the array** — 56 projected days exceeds the 10-day horizon. This is the correct new behaviour and the thing most likely to be mistaken for a bug            |
| V6  | Same bike, service 420 km out                                              | Boundary: ~10 days at 43 km/day is ~430 km. Confirm 420 km appears and 500 km does not                                                                                    |
| V7  | Anchor selection: logs at T-28, T-22, T-21, T-0                            | Both T-28 and T-21 give `offWeek = 0`; oldest-first with strict `<` keeps the **first** zero found, so T-28 wins (the longer span, per the §B comment). Assert it and write the answer into the table once seen |
| V8  | Overdue distance reminder                                                  | No projected fields, `kmRemaining` clamped to 0, unchanged otherwise                                                                                                      |
| V9  | Date-based reminder (`nextDueDate`, no interval)                           | Completely unchanged — no projected fields                                                                                                                                |
| V10 | A log whose odometer was corrected downward, making span distance negative | No projection (distance floor), fallback applies, no `-Infinity`/`NaN` in the payload                                                                                     |
| V11 | Bike with a service due and `intervalKmUsed` never set                     | Still absent entirely (H7) — confirms spec 54 is the real prerequisite                                                                                                    |
| V12 | `yarn build` + `yarn lint`                                                 | Clean; no _new_ lint errors (repo carries pre-existing ones outside Bike Log modules)                                                                                     |
| V13 | Web client against this server, same bike as V4                            | Banner shows `400 km left` with no date and no layout break (H9)                                                                                                          |

V7 is deliberately written as "assert and record" rather than asserting a value — work the tie rule through on paper during implementation and fix the expected answer in the spec then.

## Settled questions (developer, 2026-10-11)

All three of this spec's open questions were answered before implementation started. Recorded here with what was weighed, because each one is a single constant or a short client branch and will look arbitrary in six months otherwise.

1. **Horizon — 10 projected days.** (Was: 14, 21 or 30?) 14 was the draft default only because `nextDueDate` already uses it; 21 and 30 were rejected as wallpaper risks — at ~43 km/day a 30-day horizon is ~1,290 km of warning, which on a 1,000 km chain-lube interval means the reminder reappears the moment you clear it and never leaves. **10 days ≈ 430 km**, still ~8× today's 50 km, and it cannot outrun any interval above ~450 km. Implemented as `PROJECTED_UPCOMING_DAYS = 10` (D2); changing it later is one constant and no client work.
2. **Window — 4 weeks (28 days).** (Was: 8 weeks or 4?) The 5-vs-6-riding-day variance costs about `9% / sqrt(weeks)` of km/day accuracy — ±4.5% over 4 weeks vs ±3% over 8, which on a 430 km reminder is a difference of roughly half a day and is **not** the dominant error (H2 and H5 are). 4 weeks was chosen for **responsiveness**: it tracks a changed commute in a month instead of two. The accepted cost is noise from a single long highway trip, which an 8-week window would have diluted, plus the narrowed anchor band described in §B. Implemented as `PROJECTION_WINDOW_DAYS = 28` (D1).
3. **Both `nextDueOdometer` and `nextDueDate` on one type — the earlier date wins.** (Was: keep today's distance-first precedence?) Today's `getDistanceLine`, in both clients, prints the km line and never looks at `daysRemaining` whenever `nextDueOdometer` exists, so a service that is 5 calendar days from due but 400 km from due reads as `400 km left` and the nearer deadline is invisible. The decision is to show whichever of the two clocks comes first.
   - **This needs no server change and no change to this spec's code.** The server already sends `nextDueDate` and `daysRemaining` alongside the distance fields whenever both exist (`:378-380`), and `status` already honours the worse of the two clocks (`:343-349`). The comparison is a display decision and lives entirely in the client: **`bikelog_app` spec 53 §A D6 and §C** carry it.
   - Note the horizon asymmetry in D2 interacts here: the calendar clock can surface a reminder 14 days out while the distance clock needs ~10 projected days, so for a dual-clock type the calendar branch will usually be the earlier one at first sight. That is correct behaviour, not a bug to tune away.
   - The web client is **not** updated for this (H9 reasoning is unchanged — nothing breaks), so the two clients' reminder copy diverges by one line until web chooses to follow.
