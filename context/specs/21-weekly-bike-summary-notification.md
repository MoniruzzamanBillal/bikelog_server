# 21: Weekly Bike Summary Push Notification (Free Stack)

Status: ✅ Complete (Option A — GitHub Actions cron — implemented; Option B not built)

## Goal

Send an automated weekly push notification per bike summarizing the past week — fuel added, distance ridden, computed mileage (km/L), and money spent — using **only free, no-paid-tier infrastructure**: Expo's push notification service (free at any volume, no billing tier, no API key) triggered by a scheduled job hitting a new protected backend endpoint. The week runs **Friday through Thursday** (per direct user instruction), not the calendar week.

## Context

- `expoPushToken` already exists on `User` (`user.model.ts`/`user.interface.ts`, added back in spec 01) but is currently a **dead field** — confirmed via grep, nothing anywhere reads or writes it. No push-token registration endpoint exists yet.
- `context/specs/bike-log-plan.md` §7.2 already anticipated this exact mechanism ("Tier 2" push: `expo-notifications` on the client → `POST /api/users/push-token` → a scheduled job → `expo-server-sdk` on the backend), just scoped to maintenance reminders rather than a weekly digest. This spec reuses the same free mechanism for different trigger/content — a weekly summary instead of a threshold-crossing reminder.
- **Real drift from that old planning doc, worth flagging**: §5 there lists the push-token endpoint as `POST /api/users/push-token`, but `router/index.ts` actually mounts `userRouter` at `/auth`, not `/users` — so the real endpoint this spec builds is `POST /auth/push-token`. Same class of stale-planning-doc drift spec 20 flagged elsewhere in this same file set.
- **Reuse existing computation, don't reinvent it.** `mileageRecord.service.ts` already has a private `computeMileageForRange(bikeId, startDate, endDate)` → `{totalDistanceKm, totalLitersConsumed, fuelLogCount}`, and `spending.service.ts` already has a private `computeSpendingForRange(bikeId, startDate?, endDate?)` → `{totalSpending, categoryBreakdown}` — both built for the monthly/yearly/trend endpoints, both already date-range-agnostic internally, and together they already compute exactly the "distance/fuel" and "money spent" halves of the requested digest. Neither is currently exported from its module's service object. "Possible mileage" for the week = `totalDistanceKm / totalLitersConsumed` (with a divide-by-zero guard) — computed the same way every existing tab in this app already computes an average client-side, just done once server-side here since there's no client screen involved in sending a push.
- **No paid service anywhere in this design.** Expo's push notification service is free at any volume for any Expo app — no Firebase setup, no APNs certificate management, no billing tier (Expo manages those credentials internally). The only new npm dependency is `expo-server-sdk` (official, free, MIT-licensed).
- **Triggering mechanism — judgment call, flagged for your review before implementation.** This repo already has three working GitHub Actions workflows (`branch-build.yml`/`pr-checks.yml`/`deploy.yml`), so a fourth scheduled one reuses an already-proven-free, already-configured platform rather than introducing a new dependency on Vercel's Hobby-plan cron frequency/count limits (which have shifted across Vercel's own plan revisions and weren't re-verified for this spec). **Recommended: Option A, GitHub Actions `schedule` cron.** Documented as **Option B**: Vercel Cron Jobs (Hobby plan, also free) — viable, but confirm Vercel's _current_ Hobby-tier cron limits yourself before picking this if an exact once-a-week schedule (not "at most daily") turns out to matter. Pick one before implementation starts; Option A is what the rest of this spec assumes unless you say otherwise.
- Bike-log-plan.md §6 already established the pattern this spec's cron endpoint follows: unauthenticated-by-user-login but protected by a shared secret header, exactly like the `/api/cron/check-reminders` idea it sketched (never built) for the reminders use case.

## Design

### 1. Extend the `user` module — push-token registration

`POST /auth/push-token` (mounted on the existing `userRouter`, `authCheck`-protected):

- `user.validation.ts` — `pushTokenSchema = z.object({ body: z.object({ expoPushToken: z.string().min(1) }) })`.
- `user.services.ts` — `updatePushToken(userId, expoPushToken)`: `userModel.findByIdAndUpdate(userId, { expoPushToken })`, matching this module's existing minimal style.
- `user.controller.ts` — `updatePushToken` thin `catchAsync` wrapper, reads `req.user.userId` + `req.body.expoPushToken`.
- `user.route.ts` — `router.post("/push-token", authCheck, validateRequest(userValidations.pushTokenSchema), userController.updatePushToken)`.

### 2. Export the two reusable range helpers (purely additive)

- `mileageRecord.service.ts` — add `computeMileageForRange` to the `mileageRecordServices` exported object. No behavior change to any existing call site.
- `spending.service.ts` — add `computeSpendingForRange` to the `spendingServices` exported object. Same.

### 3. New `notification` module (`src/app/modules/notification/`)

**`notification.utils.ts`** — `getLastCompletedWeekRange(now: Date): {startDate: Date; endDate: Date}`: returns the most recently completed Friday 00:00:00.000–Thursday 23:59:59.999 window. Computed against a fixed **`WEEK_TZ_OFFSET_MINUTES = 360`** (Asia/Dhaka, UTC+6, no DST) constant — **flagged as an assumption**, based on the `৳` (Bangladeshi Taka) currency symbol used throughout this app's existing UI (`MaintenanceLogFormModal`'s "Cost (৳)" label, `BikeAccessoryCard`'s `৳{price.toFixed(2)}`). Confirm this is actually your timezone (and adjust the constant) before implementing — a fixed-offset constant is deliberately used instead of a timezone library (`date-fns-tz`, `luxon`, etc.) since Asia/Dhaka has no DST, keeping this dependency-free and consistent with the "free/built-in" framing of the whole feature.

**`notification.service.ts`** — `sendWeeklySummaries()`:

1. `userModel.find({ expoPushToken: { $ne: null }, isDeleted: false })`.
2. For each user, `bikeModel.find({ owner: user._id, isDeleted: false })`.
3. For each bike: `getLastCompletedWeekRange(new Date())`, then `Promise.all([computeMileageForRange(bike._id, startDate, endDate), computeSpendingForRange(bike._id, startDate, endDate)])`.
4. **Skip bikes with `fuelLogCount === 0` for the week** — no fuel logged means nothing meaningful to summarize, and avoids a spammy empty notification every single week for a bike that sat idle. Flagged as a default judgment call — an alternative is always sending a "no activity this week" digest; not done here unless you'd rather have that.
5. Build one Expo push message per remaining bike:
   - `title`: `"🏍️ ${bike.nickname} — Weekly Summary"`
   - `body`: a compact one-liner, e.g. `"142 km • 3.2 L • 44.4 km/L • ৳420 spent"` (mileage omitted or shown as `"—"` if `totalLitersConsumed` is 0 despite a nonzero `fuelLogCount`, guarding the division)
   - `data`: `{ bikeId: bike._id.toString(), type: "weekly-summary" }` — consumed by the app side (spec 24) for tap-to-open deep-linking.
6. Batch-send via `expo-server-sdk`: `Expo.chunkPushNotifications(messages)` then `expo.sendPushNotificationsAsync(chunk)` per chunk (Expo's own documented ≤100-messages-per-request limit). Receipt-checking (a follow-up pass to detect `DeviceNotRegistered` tickets and null out a stale `expoPushToken`) is **noted as a nice-to-have, not built in this pass** — a stale token just silently fails to deliver, no crash or retry storm.
7. Return `{usersProcessed, bikesSkipped, notificationsSent, notificationsFailed}` for the caller's own logs.

**`notification.controller.ts`** — `triggerWeeklySummary`: reads the `x-cron-secret` header, compares against `config.cronSecret` (plain `!==` is acceptable — this is a low-value internal trigger secret, not a login credential), 401s on mismatch, otherwise awaits `sendWeeklySummaries()` and returns its summary via `sendResponse`.

**`notification.route.ts`** — `POST /cron/weekly-summary`, **no `authCheck`** (machine-to-machine, not a logged-in user — protected by the shared secret instead).

Mounted in `router/index.ts`: `{ path: "/cron", route: notificationRouter }`.

### 4. New dependency, new config

- `package.json` — `expo-server-sdk` (official Expo package, free).
- `config/index.ts` — `cronSecret: process.env.CRON_SECRET`.
- New env var `CRON_SECRET`: local `.env` (not committed), a new Vercel Environment Variable for the deployed function, and a new GitHub Actions repository secret with the same value.

### 5. Trigger — Option A (recommended): GitHub Actions scheduled workflow

New `.github/workflows/weekly-summary-cron.yml`:

```yaml
name: Weekly Bike Summary Notification

on:
  schedule:
    # 08:00 Asia/Dhaka (UTC+6) every Friday = 02:00 UTC Friday
    - cron: "0 2 * * 5"
  workflow_dispatch: {} # manual trigger button, handy for testing

jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - name: Call weekly-summary cron endpoint
        run: |
          curl -f -X POST "https://<your-deployed-api-domain>/api/cron/weekly-summary" \
            -H "x-cron-secret: ${{ secrets.CRON_SECRET }}"
```

Requires one new repository secret (`CRON_SECRET`) — same pattern this repo already uses for `VERCEL_TOKEN`/`VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` in `deploy.yml`. Free: GitHub Actions `schedule` cron ships on every plan (unlimited on public repos; 2,000 min/month on the Free plan for private repos, and this job takes seconds per run).

**Option B (alternative, not built by default): Vercel Cron Jobs** (Hobby plan, free) — a `"crons"` entry in `vercel.json` pointing at the same route, keeping everything inside the one Vercel project instead of adding a GitHub Actions workflow. Not chosen as the default here since Vercel's Hobby-tier cron frequency/count limits have shifted across plan revisions and weren't independently re-verified for this spec — confirm current limits on Vercel's own pricing/docs page before choosing this over Option A.

## Implementation

1. ✅ `user.validation.ts` / `user.services.ts` / `user.controller.ts` / `user.route.ts` — added `POST /auth/push-token` (`pushTokenSchema`, `updatePushToken`, `authCheck`-protected).
2. ✅ `mileageRecord.service.ts` — exported `computeMileageForRange` from `mileageRecordServices`.
3. ✅ `spending.service.ts` — exported `computeSpendingForRange` from `spendingServices`.
4. ✅ New `src/app/modules/notification/notification.utils.ts` — `getLastCompletedWeekRange` (fixed UTC+6 offset, general "most recent Friday ≤ now, step back one week" definition — correct for any call day, not just Friday).
5. ✅ New `src/app/modules/notification/notification.service.ts` — `sendWeeklySummaries` (queries users with a push token, their bikes, computes mileage+spending per bike for the last completed week, skips zero-fuel-log bikes, batches via `expo-server-sdk`).
6. ✅ New `src/app/modules/notification/notification.controller.ts` — `triggerWeeklySummary` (`x-cron-secret` header check against `config.cronSecret`).
7. ✅ New `src/app/modules/notification/notification.route.ts` — `POST /weekly-summary` (mounted at `/cron`, no `authCheck`).
8. ✅ `router/index.ts` — mounted `/cron` → `notificationRouter`.
9. ✅ `config/index.ts` — added `cronSecret: process.env.CRON_SECRET`.
10. ✅ `package.json` — added `expo-server-sdk@7.0.0` (`yarn add`, lockfile updated).
11. ⏳ `.env` (local) + Vercel project env vars — **not touched by this pass** (deliberately not reading/writing the real `.env` — a secrets file). Add `CRON_SECRET` to your local `.env` and to the deployed Vercel project's Environment Variables yourself before relying on this in production; the live verification below used a temporary shell-level override instead of the committed `.env`.
12. ✅ `.github/workflows/weekly-summary-cron.yml` — new scheduled workflow (Option A). Needs 2 repository secrets added on GitHub's side (`API_BASE_URL`, `CRON_SECRET`) before the schedule can actually fire successfully — not something this pass can do from the repo itself.
13. ✅ `postman/bikelog-api.postman_collection.json` / `postman/dummy-data.md` — added "Update Push Token" (Auth folder) and a new "Cron" folder with "Trigger Weekly Summary", plus a new `cronSecret` collection variable and matching `dummy-data.md` sections.

## Dependencies

`expo-server-sdk` (new, free). Reuses existing `fuelLogModel`/`maintenanceLogModel`/`bikeModel`/`userModel`, and (once exported) `computeMileageForRange`/`computeSpendingForRange`. No paid service, no new database, no new hosting account required for Option A. The app-side counterpart (`bikelog_app/ai context/specs/24-weekly-bike-summary-notification.md`) depends on this spec's `POST /auth/push-token` endpoint existing before it can register a real device token.

## Verify

- [x] `POST /auth/push-token` with a valid JWT stores the token on the right user (confirmed live: `GET`-equivalent response after the call showed `expoPushToken` set to the sent value); an empty token 400s via Zod (confirmed live: `{"expoPushToken":""}` → `400`).
- [x] `POST /cron/weekly-summary` with a wrong `x-cron-secret` returns 401 (confirmed live: `401`); missing header also 401s (confirmed live: `401`).
- [x] With the correct secret, a seeded user + bike + one fuel log dated inside the computed target week (`2026-07-27`, inside the live-computed `2026-07-23T18:00Z`–`2026-07-30T17:59:59.999Z` window) resulted in the bike being counted (not skipped) and a real push request sent to Expo's actual push API — `{usersProcessed:1, bikesSkipped:0, notificationsSent:0, notificationsFailed:1}`, the 1 failure being Expo's own service correctly rejecting the test's syntactically-valid-but-fake token (`ExponentPushToken[cronTestFakeToken12345]`), which confirms the full send pipeline (message built, chunked, POSTed to Expo, ticket parsed) ran for real, not just that a message object was constructed.
- [x] A second bike with zero fuel logs in the target week was correctly skipped: re-running the same cron call with both bikes present returned `bikesSkipped: 1` for the empty one, `notificationsFailed: 1` for the one with a fuel log — confirmed live, not just by code reading.
- [x] A user with `expoPushToken: null` is skipped entirely — implied by the `{ expoPushToken: { $ne: null } }` query itself (standard MongoDB null/missing-field semantics, confirmed via `mongoose` docs reasoning, not separately live-tested with a second no-token user in this pass).
- [x] `getLastCompletedWeekRange` manually checked against 3 real dates: a Friday-morning cron-trigger case (`2026-08-07T02:00Z` → correctly `2026-07-31`–`2026-08-06` Dhaka), a month-boundary-crossing case (`2025-03-07T02:00Z` → correctly `2025-02-28`–`2025-03-06` Dhaka, spanning Feb→Mar), and a year-boundary-crossing case (`2026-01-02T10:00Z` → correctly `2025-12-26`–`2026-01-01` Dhaka, spanning Dec 2025→Jan 2026) — all three computed by hand via a standalone Node script mirroring the function's exact logic, not just eyeballed.
- [x] `yarn build` — clean. `yarn lint` — 0 errors, same 14 pre-existing `no-console` warnings, none new (confirmed via `npx eslint` scoped to every touched/new module: 0 output).
- [ ] End-to-end OS notification delivery to a real device is **not yet confirmed** — requires the app side (spec 24, code-complete but not yet run on a real device/development build in this environment) and a real (not fake) Expo push token. Everything up to and including Expo's own API accepting/processing the send request is confirmed live above; only the final on-device delivery hop is unverified.
