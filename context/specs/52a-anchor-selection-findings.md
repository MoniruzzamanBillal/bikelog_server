# 52a: Anchor-selection findings — what V7 actually answers

Status: ✅ **Complete.** Recorded 2026-10-12 while implementing spec 52.
Companion to `52-service-due-date-projection.md`. **No code change came out of this** — `computeKmPerDay` behaves exactly as §B specifies. What changed is spec 52's own §B claim and its V7 expected answer, both of which were written from paper reasoning that does not survive contact with the `gte` window boundary.

Sibling of `51a` and `30a` in intent: a short record of something found during implementation that a future reader would otherwise have to rediscover.

---

## Finding 1 — a span of exactly 28 days is unreachable, so V7's expected answer was wrong

Spec 52's V7 row predicted: _"logs at T-28, T-22, T-21, T-0 … T-28 wins (the longer span)."_ It does not. **The anchor is T-21 and the span is 21 days**, because the T-28 log is never read in the first place.

`since` is computed inside `computeKmPerDay` at request time:

```ts
const since = new Date(Date.now() - PROJECTION_WINDOW_DAYS * DAY_MS);
```

A log dated exactly 28 days before the request therefore sits a few milliseconds *outside* `date: { gte: since }` — whatever elapsed between the row being written and the query running. Observed directly: with the oldest log at T-28.0 the query returns 2 of 3 rows; at T-27.999 it returns all 3. So the reachable span is strictly **less than** 28 days, and the 28-vs-21 off-week tie the §B comment describes **cannot occur for those two values**.

Once T-28 drops out, the candidates are T-22 (span 22, `offWeek` 1) and T-21 (span 21, `offWeek` 0). T-21 wins outright — no tie, no strict-`<` involvement.

**The rule in §B is still correct; only this fixture's outcome was.** A genuine `offWeek` tie resolves to the longer span exactly as documented — verified separately with spans of 27.9 and 20.9, both `offWeek` 0.1, where the loop keeps T-27.9.

On this fixture the correction costs nothing: the data is linear, so both anchors give `kmPerDay = 42.857`. On non-linear data they would differ, which is why it is worth recording rather than shrugging at.

## Finding 2 — §B's "two near-exact-week spans (21 and 28)" overstates the choice

§B reads: _"every usable anchor sits in a **14-day band** (14–28 days old), so there are at most two near-exact-week spans to choose between (21 and 28)."_

Two corrections, in increasing order of practical importance:

1. 28 exactly is unreachable (Finding 1), so the honest ceiling is "just under 28".
2. **More importantly, the band is about candidate *age*, while `spanDays` is measured to the *latest* log — not to now.** So the reachable span is capped at `28 − (age of the newest fuel log)`. With a newest log 3 days old the longest possible span is 25 days, and only 21 and 14 remain near-whole-week. Verified: logs at T-28/T-24/T-17/T-3 pick T-24 (span 21, `offWeek` 0) over T-28 (span 25, `offWeek` 3).

This is H2 restated as a bound rather than a warning, and it makes the window **narrower in practice than §B implies** for exactly the rider §B worries about — one who fills up rarely. It does not weaken the design: the snapping still removes the weekday bias whenever a near-whole-week candidate exists, and when none does the `offWeek` minimum still picks the least-biased available span. It is a tolerated loss of precision, as §B already says of the narrowed band.

## Finding 3 — an exact whole-week span always beats a near one, which is the intended behaviour

Worth stating because it looks like the tie rule misfiring. With the oldest log anywhere in T-27 … T-27.999 and another at exactly T-21, the T-21 log wins every time (`offWeek` 0 vs 0.1–1.0) even though T-27.x is the longer span. That is the §B rule working: nearest whole number of weeks first, span length only as a tiebreaker. The "longer span wins" comment applies **only** to an exact `offWeek` tie, and the comment says so — but it is easy to read it as a general preference for more data, which it is not.

---

## How this was verified

No live server and no database. The arithmetic was exercised by evaluating the **verbatim shipped source text** of the constants, `computeKmPerDay`, and the `getRemindersFromDB` reminder loop — sliced out of `maintenanceLog.service.ts` by string markers, so the code under test is the code that ships — against synthetic `FuelLog` fixtures with `prisma.fuelLog.findMany` stubbed to apply the same `isDeleted`/`gte`/`orderBy` semantics.

38 assertions, all passing, covering spec 52's V1–V11 at the function level plus five of its own: the window boundary sweep behind Finding 1, the stale-latest-log case behind Finding 2, a genuine `offWeek` tie, `projectedDays` resetting per maintenance type (the §C checklist item that a hoisted declaration would break), and a payload scan for `NaN`/`Infinity`/`null` on the H10 odometer-correction path.

**The harness was deliberately not committed.** It eval-s source text through `new Function` and strips TypeScript with regexes — appropriate for a one-off check of pure arithmetic, not something to maintain or to mistake for the test suite this repo does not have. It lives in the session scratchpad.

**What this does not cover, and what still needs an operator.** Nothing was exercised over HTTP, against Postgres, or against the real `PrismaNeon` adapter. So the actual Prisma query (`where`/`select`/`orderBy` as Prisma compiles it), the `Float` → `number` round-trip on `odometerReading`, `Date` serialisation of `projectedDueDate` through `sendResponse`, and spec 52's V13 (the web banner) are all still unverified. Spec 52's test plan via Postman remains the thing that would settle them. `ws` is not installed, so the spec 46/48–50-era WebSocket-proxy harness that ran a built `dist/` against a throwaway local Postgres could not be rebuilt without adding a dependency.
