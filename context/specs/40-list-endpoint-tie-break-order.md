# Spec 40 — Deterministic list ordering (date-only-field tie-break)

**Status: Complete** (2026-09-30)

## Context

User report, from real use of the mobile app's Fuel logs screen: _"the data which i added latest should be shown first then the rest."_ A newly-added fuel log did not reliably appear at the top of the list.

This was **not** a client bug. `bikelog_app`'s `FuelLog.tsx` already requests
`/bikes/:bikeId/fuel-logs?page=1&limit=10&sort=-date`, and `getFuelLogsFromDB` already
defaults to `defaultSort: "-date"`. Both were correct; the ordering was still wrong.

Root cause is a **missing tie-breaker**:

1. Clients submit `date` as a date-only string (`"2026-09-30"`) — `DatePickerField` is
   `mode="date"` and `FuelLogFormModal` stores/sends `yyyy-MM-dd`.
2. `fuelLog.validation.ts`'s `z.coerce.date()` turns that into exactly
   `2026-09-30T00:00:00.000Z`. No time component ever reaches the column.
3. So **every fuel log entered on the same calendar day holds an identical `date`**.
4. `buildPrismaListQuery` emitted `orderBy: [{ date: "desc" }]` and nothing else. SQL
   leaves tied rows in no defined order, so today's logs came back in whatever order
   Postgres happened to produce — the newest one anywhere among them.

Two distinct defects follow from this, and the second was never reported but is worse:

- **Reported:** newest-entered row not shown first among same-day rows.
- **Unreported:** `skip`/`take` pagination over a nondeterministic order is unstable — a
  row can appear on two consecutive pages, or be skipped entirely, between requests.

The same flaw applied to **every** list endpoint using this helper, not just fuel logs —
each one sorts on a date-only field or a coarse enum:

| Endpoint            | `defaultSort`           | Tied whenever…                    |
| ------------------- | ----------------------- | --------------------------------- |
| `fuelLog`           | `-date`                 | two fills share a calendar day    |
| `maintenanceLog`    | `-serviceDate`          | two services share a calendar day |
| `bikeIssue`         | `status -dateReported`  | two issues share day + status     |
| `bikeDocument`      | `-createdAt`            | never (already total)             |
| `errorLog`          | `-createdAt`            | never (already total)             |

## Design

Fix once in the shared builder rather than per-module, since the cause is shared and a
per-module fix would leave the same latent bug in whichever module was missed.

`buildPrismaListQuery` appends `{ createdAt: "desc" }` as a final `orderBy` entry, making
the sort **total**. `createdAt` is DB insertion time and unique in practice, so tied rows
fall back to newest-entered-first — which is exactly the reported requirement.

Guarded so it is not appended when the caller already sorts on `createdAt` (either
direction), which would otherwise emit a contradictory duplicate key for `bikeDocument`
and `errorLog`.

Deliberately **not** done:

- **Storing a real time-of-day in `date`.** It's a user-chosen calendar date, not a
  timestamp; giving it submit-time would corrupt backdated entries and change the meaning
  of the mileage-period date-range queries in `createFuelLogIntoDB`.
- **Changing the client's `sort=-date`.** It is correct as written, and a client-side
  `sort=-date,-createdAt` would fix only the one screen that asked for it while leaving
  the server contract broken for the web client and every other list endpoint.
- **A Prisma migration.** No schema change — `createdAt` already exists on all six models.

## Implementation

- `src/app/builder/buildPrismaListQuery.ts` — parsed sort fields hoisted into a
  `sortFields` const (previously inlined into the `.map()`), `orderBy` given an explicit
  `Record<string, "asc" | "desc">[]` annotation so it stays mutable and typed, then the
  guarded `createdAt` tie-break pushed on. Comment records why the tie exists at all,
  since the root cause lives in the validation/client layers, not here.

No other file changed. No client change required — `bikelog_app` and
`bikelog_client-web-` both benefit without edits.

## Verify

- [x] `yarn build` (`tsc`) clean.
- [x] `eslint src/app/builder/buildPrismaListQuery.ts` clean.
- [x] Resulting `orderBy` asserted by running the compiled helper directly against all
      five caller shapes:
      - `{sort: "-date"}` → `[{date:desc},{createdAt:desc}]`
      - no `sort` param, `-date` default → `[{date:desc},{createdAt:desc}]`
      - `-serviceDate` → `[{serviceDate:desc},{createdAt:desc}]`
      - `status -dateReported` → `[{status:asc},{dateReported:desc},{createdAt:desc}]`
      - `-createdAt` → `[{createdAt:desc}]` (**no duplicate** — guard works)
      - `page=2` → same `orderBy`, `skip=10 take=10`
- [x] **Verified live against the real Neon DB, A/B against the deployed un-fixed build.**
      Local server on an isolated `PORT=5099` against the production `DATABASE_URL`. Because
      the deployed Vercel instance reads that *same* Neon DB while still running the un-fixed
      code, both could be pointed at byte-identical rows — a true A/B, not two separate runs.
      - **Fixture**: throwaway bike `ZZ Sort Test` + 5 fuel logs all submitted with
        `date: "2026-09-30"` and `isFullTank: false` (false deliberately — keeps
        `MileageRecord` closure out of the test and cleanup trivial; confirmed 0 created).
        All 5 stored `date: 2026-09-30T00:00:00.000Z` — **identical**, directly confirming
        the date-only tie premise rather than assuming it.
      - **Fixed** → `entry-5 → entry-4 → entry-3 → entry-2 → entry-1` (newest-added first).
        **Deployed/un-fixed** → `entry-1 → … → entry-5`, newest-added **last**. Repeated 4×
        consecutively on each; both stable across runs.
      - **Correction to this spec's own Context, from what the test actually showed:** the
        un-fixed order is not "arbitrary" in practice — Postgres returned tied rows in
        physical heap order, which for freshly-inserted, never-updated rows equals insertion
        order. So the real-world symptom is the reliable **worst case** (newest always last),
        not an intermittent one. That is why the user saw it every time.
      - **Multi-field caller (`bikeIssue`, `status -dateReported`)**: 3 issues tied on *both*
        sort keys → fixed `issue-3 → issue-2 → issue-1`, un-fixed `issue-1 → issue-2 →
        issue-3`. Then resolved the *newest* issue and confirmed it dropped **below** both
        open ones — proving the appended tie-break only breaks ties and does **not** displace
        the primary `status` sort.
      - **Pagination** (`limit=2`, pages 1–3): fixed paged cleanly `[5,4] [3,2] [1]`, 5/5
        unique, no repeat, none missing. **Honest limit:** no actual repeated or dropped row
        was observed on the un-fixed build at this data size — what *was* observed is order
        instability across query shapes (its page 1 came back `entry-2,entry-1`, reversed
        relative to its own unpaginated `entry-1…5`). The repeat/skip hazard remains a
        reasoned consequence of a non-total order, not something reproduced here.
      - **Also reproduced on real user data, no fixture needed:** the live `Hornet` bike has
        3 genuine fuel logs sharing `2026-09-30`. Deployed returned them
        `odo 1750 → 2000 → 1800` (the most recently added, `odo 2000`, sitting **second**);
        the fixed server returned `2000 → 1800 → 1750`, exact `createdAt` order. Rows 4–8
        (distinct dates) were byte-identical on both — confirming the change is inert
        wherever no tie exists.
      - **Cleanup**: fixture hard-deleted via a throwaway `src/scripts/__tmpSpec40Cleanup.ts`
        (guarded to refuse any bike not named `ZZ Sort Test`, scoped to one `bikeId`), which
        was deleted immediately after running — same pattern as specs 37/38/39. Verified 0
        fuel logs / 0 issues / 0 bike rows remain, and `Hornet` untouched (odo 2000, 8 logs,
        still the account's only bike). No test user was created — `abc@d.com` already existed.
- [ ] **Still needs deploy before the app sees it.** `bikelog_app`'s `utils/envConfig.ts`
      points at `https://bikelog-server.vercel.app`, so this fix only reaches the app once
      merged to `master` (`deploy.yml`). The A/B above *is* the proof it works; what is
      unverified is only the app's own UI rendering the corrected order, which cannot change
      until the deploy happens.
