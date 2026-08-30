# 29: Diagnose Why Weekly Push Notifications Never Arrive on Device

Status: ⛔ Not started

## Goal

Per direct user report: they never receive the weekly bike-summary push notification on their phone, even though spec 21 (this backend's send pipeline) and spec 24 (`bikelog_app`'s client registration) are both marked Complete, and the user confirms they're testing with a real EAS development build (not Expo Go, which would rule out the client entirely since it can't receive remote push on SDK 53+). Find the actual break point and get one real notification delivered, adding only enough logging to make the failure visible — not a full production-hardening pass (receipt-checking, stale-token cleanup, etc. are explicitly out of scope here; see Dependencies).

## Context

- Spec 21's own Verify section already flagged this as unconfirmed: "End-to-end OS notification delivery to a real device is not yet confirmed... Everything up to and including Expo's own API accepting/processing the send request is confirmed live above; only the final on-device delivery hop is unverified." The one live test used a fake, syntactically-valid token (`ExponentPushToken[cronTestFakeToken12345]`) that Expo correctly rejected — proving the pipeline reaches Expo's API, never proving actual device delivery.
- `src/app/modules/notification/notification.service.ts`'s `sendWeeklySummaries`:
  - Queries `userModel.find({ expoPushToken: { $ne: null }, isDeleted: false })` — a user whose token never got persisted is silently excluded, with nothing distinguishing "no users to notify" from "everything is broken."
  - Skips a bike entirely (`bikesSkipped++`) if it had zero fuel logs in the current week — by design, but looks identical to "broken" from the outside.
  - Validates each token with `Expo.isExpoPushToken` before building messages; an invalid token increments `notificationsFailed` and `continue`s with **no console output at all** — only visible in the numeric JSON response body of the one-off HTTP call.
  - Calls `expo.sendPushNotificationsAsync(chunk)` per chunk and counts `status === "ok"` as sent — but **never calls `getPushNotificationReceiptsAsync`**, so an `"ok"` ticket only proves Expo *accepted* the message, not that the device received it. No receipt-checking exists anywhere in this file today.
- `notification.controller.ts`'s `triggerWeeklySummary` is protected only by an `x-cron-secret` header check (`secret !== config.cronSecret` → 401), no JWT — this endpoint can already be called manually (curl/Postman, or the GitHub Actions workflow's `workflow_dispatch`) without waiting for Thursday's schedule; use this for testing.
- `config.cronSecret` reads `process.env.CRON_SECRET`, which is **confirmed absent from the local `.env`** (per spec 21's own implementation notes, left for the user to add) — its presence on the deployed Vercel project has never been re-verified. If it's unset on Vercel, `config.cronSecret` is `undefined` there and the manual test call (and the real cron) will 401.
- `.github/workflows/weekly-summary-cron.yml` builds the target URL as `"${{ secrets.API_BASE_URL }}/cron/weekly-summary"` (no `/api` baked into the workflow) — the `API_BASE_URL` repo secret itself must already include the `/api` prefix (matching `src/app.ts`'s `app.use("/api", MainRouter)`) or every scheduled run 404s. Worth checking the Actions tab's run history for 401/404s as a first, free diagnostic.
- No `EXPO_ACCESS_TOKEN` or Expo-related env var is read anywhere in this codebase (`new Expo()` is called with no options) — this is not the cause of any FCM credential gap; those live on the Expo/EAS project side (`bikelog_app`), not as a server env var. See the paired `bikelog_app` spec 34 for the FCM V1 credentials check, which is out of this repo's scope to fix directly.
- Root cause is not yet known — this spec's job is to narrow it down using the manual verification steps below, then add just enough logging to confirm it live.

## Design

### Manual verification (do first, no code — these narrow down which half of the stack is actually broken)

1. Query the test user's document in MongoDB for `expoPushToken`. If `null`/missing, the break is entirely on the `bikelog_app` side (spec 34) — the token never reached this backend at all.
2. Confirm the test bike has ≥1 fuel log inside the current Friday 00:00–Thursday 23:59:59.999 Asia/Dhaka window (`notification.utils.ts`'s `getCurrentWeekRange`) — otherwise it's silently skipped regardless of everything else.
3. Confirm `CRON_SECRET` is set in `bikelog_server/.env` locally **and** in the Vercel project's env vars for the deployed backend, and that it matches whatever secret is used for the manual test call below.

### `src/app/modules/notification/notification.service.ts`

Add minimal diagnostic logging only — no behavior change:

- In the invalid/missing-token skip branch (where `notificationsFailed` is currently incremented with no output): `console.error(\`[weekly-summary] skipping user ${user._id}: invalid/missing expoPushToken\`)`.
- After each `sendPushNotificationsAsync(chunk)` call, log each ticket's `status`/`message`/`details` (e.g. `console.log(\`[weekly-summary] ticket:\`, ticket)` per ticket) so a manual trigger's server logs show precisely why a send did or didn't happen for a given token — including Expo-side rejection reasons (`DeviceNotRegistered`, `MessageTooBig`, etc.) that are currently discarded.

No changes to the query, the skip logic, or the send logic itself — this spec is diagnosis-only for the backend half.

## Implementation

1. ⬜ `src/app/modules/notification/notification.service.ts` — add the two `console.error`/`console.log` diagnostic points described above.
2. ⬜ Manually trigger `POST /api/cron/weekly-summary` (with the correct `x-cron-secret` header) against the deployed backend and read the JSON response + new server logs to identify exactly where this user's send fails or succeeds.
3. ⬜ Cross-check findings against the paired `bikelog_app` spec 34 — if the token was never persisted, the fix is entirely client-side; if it was persisted and Expo's ticket/receipt indicates a real delivery failure, that points to the FCM V1 credentials gap covered in spec 34.
4. ⬜ `context/progress-tracker.md` — flip this row Not Started → Complete once a real notification is confirmed delivered end-to-end, and note the actual root cause found.

## Dependencies

Paired with `bikelog_app` spec 34 (client-side diagnostics + EAS FCM credentials check) — this spec's manual trigger step is how spec 34's client-side fix gets validated end-to-end. **Not in scope for either spec**: server-side receipt-checking (`getPushNotificationReceiptsAsync`) to auto-null stale tokens, or any other production-hardening beyond making the current failure visible — log as a Known Gap in this tracker if the eventual root cause is something receipt-checking would have caught sooner.

## Verify

- [ ] Manual trigger (`POST /api/cron/weekly-summary` with correct `x-cron-secret`) against the deployed backend returns a JSON response with `notificationsSent: 1` for the test user (not `notificationsFailed`/`bikesSkipped`).
- [ ] New server logs from the diagnostic points show a clean `"ok"` ticket for the test user's token (no `DeviceNotRegistered` or other Expo-side rejection).
- [ ] A real OS notification banner appears on the test device (backgrounded app) after the manual trigger.
- [ ] Foreground receipt and tap-to-deep-link into the correct bike screen also confirmed (owned by `bikelog_app` spec 34, verified together in the same test pass).
- [ ] Root cause documented in this file's Context/Implementation once found, and mirrored into `context/progress-tracker.md`'s Known Gaps if any part of the pipeline is left intentionally unfixed (e.g. receipt-checking).
- [ ] `yarn build` clean; `yarn lint` — no new errors beyond the existing baseline.
