# 56 — The oil card always has a date: a fallback riding rate, an overdue date, and a provisional interval

**Status**: ✅ Code complete — implemented 2026-10-19. `yarn build` clean, `yarn lint` 0 errors / 36 warnings
(pre-existing baseline, none in the three touched files). Verified at **function level with Prisma stubbed —
32 assertions across 6 scenarios, green**: the unchanged recent-rate path, both fallback rates, a stale
history refused, the overdue past-date, the provisional estimate, and the no-type case that produces none.
**Nothing has been exercised over HTTP or against real data.**
**Scope**: `bikelog_server/` only, three files, no migration: `util/ridingRate.ts` (a new exported helper),
`engineOilLog/engineOilLog.utils.ts` (one extra selected column), `engineOilLog/engineOilLog.service.ts`
(`getEngineOilStatusFromDB` + one new local helper) and `engineOilLog.interface.ts`, plus Postman.
**Companion**: `bikelog_app/ai context/specs/59-oil-due-date-estimate.md` (the card).
**Purely additive — no existing field changes type, and the only existing field whose *presence* changes is
`projectedDueDate`, which now also appears when overdue.** `bikelog_client-web-` needs no change (cascade
step 3 is not triggered): its `EngineOilStatusCard` ignores `projectedDueDate` in the overdue branch and
prints `projectedDaysRemaining` verbatim in an audit line — which is exactly why that field is left absent
when overdue rather than going negative (D3).

---

## Request

> in engine oil page , in the first stat section , i told you to give possible date of the engine oil change .
> you did not do it .

Spec 54 §D *did* ship the date, and `bikelog_app` spec 57's card renders it — but only in one of the four
states the endpoint can answer with. The developer is looking at one of the other three. This spec is about
making the date appear in all of them.

---

## Goal

`GET /bikes/:bikeId/engine-oil-logs/status` should answer "around when is the next change due?" for every
bike that has an oil log at all — including a bike whose fuel history is too thin for the strict rate, a
change that is already overdue, and a change that carries no interval of its own — without moving a single
`status` value or reminder threshold.

---

## Design

### Why there was no date (the three gaps, in the order they bite)

1. **No interval on the log** → `nextDueOdometer` is null, `evaluateOilDue` returns `status: "unknown"`, and
   nothing downstream exists. Every change logged before spec 54 started seeding `intervalKmUsed`, plus every
   row the §H import created from a maintenance log that had none, is in this state. This is the most likely
   state for the developer's own newest change, and `../../CLAUDE.md` already warns that specs 53/54/55 are
   "largely invisible" until the catalog catch-up is done.
2. **No riding rate** → `computeKmPerDay` is strict on purpose (≥2 fuel logs inside 28 days, ≥14 days apart,
   ≥100 km between them) because it decides whether a **reminder** fires. Miss any one condition and
   `projectedDays` is undefined, so the card falls back to "~1,000 km to go".
3. **Overdue** → `evaluateOilDue` returns before computing `projectedDays` at all, so the card prints the
   overshoot in km and no date.

### Decisions

| # | Decision | Why |
| --- | --- | --- |
| D1 | A **separate, looser fallback rate** (`computeFallbackKmPerDay`) used for the **date only**, never passed to `evaluateOilDue` | The strict rate's job is to decide `status`, and through it which reminders fire — "we have enough history to alert you" is a different question from "roughly how many km a day do you ride". Loosening the strict one would quietly re-arm distance reminders for every bike with thin history and would make the status card and the hub's `RemindersBanner` disagree. Keeping them apart means **no `status` value, anywhere, changes because of this spec** (H2) |
| D2 | The fallback tries **all fuel history** first, then the **bike's lifetime odometer** (`currentOdometer - initialOdometer` over days since `purchaseDate`) | In that order, because the first still measures riding and the second measures ownership. The lifetime figure needs no fuel log at all, which is what covers the rider who logs maintenance but barely logs fuel — and `currentOdometer` is raised by every log and by Settings' manual update (spec 44), so it is live |
| D3 | An overdue change gets **`projectedDueDate` in the past** plus a new positive **`overdueDays`**; `projectedDaysRemaining` stays absent | "Was due ~ 3 Oct" is the one phrasing that tells the rider how stale the oil is in units they think in. `projectedDaysRemaining` is deliberately not made signed: `bikelog_client-web-`'s card prints it into an audit line as `${n} days`, so a negative would read as "-12 days" there with no code change of ours |
| D4 | A change with no interval of its own gets a whole **`estimate` object**, derived from the oil type's **current** `suggestedIntervalKm` | Spec 54 H6 froze `intervalKmUsed` on the row precisely so a catalog edit cannot retroactively move a past change's due point. That reasoning holds for rows that *have* an interval; for a row with none there is no due point to move, and the catalog's current suggestion is a better answer than silence. It is kept in its own object so **no existing field silently becomes a guess** — a client must opt in and must label it |
| D5 | `rateBasis` gains `source: "recent" \| "history" \| "lifetime"` | A date derived from a lifetime average deserves to be labelled as such by the client. One optional key on an object no client currently renders |
| D6 | The fallback refuses a fuel history whose **newest log is over 365 days old** | A bike parked for two years would otherwise project a confident date off the riding it did before it was parked. Falling through to the lifetime figure is no better in that case, but it is at least measured over the same period it claims |
| D7 | One local `projectDueDate(kmRemaining, kmPerDay)` helper, shared by the real forecast and the estimate | The signed-remaining → date arithmetic now has four call sites between the two. `Math.floor` in both directions, for spec 52 H5's reason: `currentOdometer` lags reality between logs, so every figure here is biased late, and late is the one direction an oil-change date must not err in |
| D8 | `findLatestEngineOilLog`'s include gains `suggestedIntervalKm` | D4 needs it. It is selected, never spread into a response; `getRemindersFromDB`, the function's other caller, reads `oilType?.name` only |

### Contract (additions only)

```
GET /bikes/:bikeId/engine-oil-logs/status
  rateBasis.source?: "recent" | "history" | "lifetime"
  overdueDays?:      number        // positive, only with status "overdue" + a usable rate
  projectedDueDate?: Date          // UNCHANGED shape; now also present when overdue (in the past)
  estimate?: {
    basis: "oilTypeSuggestion"
    status: "ok" | "upcoming" | "overdue"
    intervalKm: number
    nextDueOdometer: number
    kmRemaining: number            // signed, same convention as the top-level field
    percentUsed: number
    projectedDaysRemaining?: number
    projectedDueDate?: Date
    overdueDays?: number
  }
```

---

## Hazards

| # | Hazard | Handling |
| --- | --- | --- |
| H1 | A looser rate could **re-arm distance reminders** for bikes that deliberately have none (spec 52 H6) | The fallback is computed in the status service and never reaches `evaluateOilDue` or `getRemindersFromDB`. Verified: the stubbed pass asserts `status` is identical in every scenario to what the strict rate alone produces |
| H2 | The estimate is **not stable** — edit the oil type's suggestion and the date moves | By design, and the reason it lives in its own object with a `basis` tag. The app labels every line it produces `est.` and ends the card with the sentence that makes it exact ("set an interval on this change") |
| H3 | `percentUsed` inside the estimate can exceed 100 | Same as the top-level field; the client clamps the bar at 100 and has done since spec 57 |
| H4 | The lifetime figure divides by days since `purchaseDate`, which is rider-entered and can be wrong | Guarded the same way the strict rate is: ≥14 days span and ≥100 km, so a same-week purchase date or a zero-distance bike yields `null` rather than a wild rate. A *future* purchase date gives a negative span, which fails `>= 14` and is refused |
| H5 | Two more queries on a cache-less endpoint when the strict rate is unavailable | Two indexed `findFirst`s on `fuel_logs` (`@@index([bikeId])`), and only in the case that currently answers with no date at all. The common case — a rider with recent fuel logs — adds **zero** queries, because the fallback is behind `rate ?? …` |
| H6 | `evaluateOilDue`'s `"unknown"` branch is unreachable for the estimate's synthetic log | True by construction (`nextDueOdometer` is always non-null there), which is why the status is narrowed with a cast rather than widened in the payload type. Asserted in the stubbed pass |

---

## Implementation steps

1. `util/ridingRate.ts` — `TRateSource`, `source: "recent"` on `computeKmPerDay`'s return, and the new
   `computeFallbackKmPerDay(bike)` with its two attempts and the staleness guard. ✅
2. `engineOilLog.utils.ts` — select `suggestedIntervalKm` on the latest log's oil type. ✅
3. `engineOilLog.interface.ts` — `overdueDays`, `rateBasis.source`, `estimate`. ✅
4. `engineOilLog.service.ts` — `projectDueDate` helper; `projectionRate = rate ?? fallback` used for the
   date, `kmPerDay` and `rateBasis` only; the overdue branch; the `estimate` block. ✅
5. Postman — the status request's description now enumerates all three additions. ✅

---

## Test plan

| # | Check | State |
| --- | --- | --- |
| V1 | Recent rate, 1,000 km to go at 40 km/day → `projectedDaysRemaining` 25, date +25 d, `source: "recent"`, no `overdueDays`, no `estimate` (identical to pre-spec-56) | ✅ stubbed |
| V2 | One fuel log inside 28 days, 1,200 km over 115 days of history → `source: "history"`, `kmPerDay` 10.4, days 95 | ✅ stubbed |
| V3 | No fuel logs at all, 10,000 km over 400 days of ownership → `source: "lifetime"`, `kmPerDay` 25, days 40 | ✅ stubbed |
| V4 | Newest fuel log 800 days old → history refused, falls through to lifetime (D6) | ✅ stubbed |
| V5 | Overdue by 400 km at 40 km/day → `overdueDays` 10, date −10 d, `projectedDaysRemaining` absent | ✅ stubbed |
| V6 | `intervalKmUsed` null + an oil type suggesting 3,000 km → top-level still `unknown` with no date, `estimate` carries interval 3,000, due 11,000, remaining 1,000, 67%, days 25 | ✅ stubbed |
| V7 | `intervalKmUsed` null + **no** oil type → no `estimate`, `kmSinceChange` still present | ✅ stubbed |
| V8 | `status` is byte-identical to the pre-spec-56 answer in every scenario above | ✅ stubbed |
| V9 | `GET /status` over HTTP on the developer's real bike returns a date in whichever state it is actually in | ⬜ the pass that matters, and the only one that confirms the reported bug is fixed |
| V10 | The hub's `RemindersBanner` shows the same set of reminders before and after | ⬜ needs a live server |
| V11 | `yarn build` + `yarn lint` clean | ✅ |
