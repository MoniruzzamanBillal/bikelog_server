# 29: Diagnose Why Weekly Push Notifications Never Arrive on Device

Status: ✅ Complete (backend diagnosis complete — root cause found: zero registered push tokens; end-to-end delivery needs `bikelog_app` spec 34's client-side registration fix — see Verify)

## Goal

Per direct user report: they never receive the weekly bike-summary push notification on their phone, even though spec 21 (this backend's send pipeline) and spec 24 (`bikelog_app`'s client registration) are both marked Complete, and the user confirms they're testing with a real EAS development build (not Expo Go, which would rule out the client entirely since it can't receive remote push on SDK 53+). Find the actual break point and get one real notification delivered, adding only enough logging to make the failure visible — not a full production-hardening pass (receipt-checking, stale-token cleanup, etc. are explicitly out of scope here; see Dependencies).

## Context

- Spec 21's own Verify section already flagged this as unconfirmed: "End-to-end OS notification delivery to a real device is not yet confirmed... Everything up to and including Expo's own API accepting/processing the send request is confirmed live above; only the final on-device delivery hop is unverified." The one live test used a fake, syntactically-valid token (`ExponentPushToken[cronTestFakeToken12345]`) that Expo correctly rejected — proving the pipeline reaches Expo's API, never proving actual device delivery.
- `src/app/modules/notification/notification.service.ts`'s `sendWeeklySummaries`:
  - Queries `userModel.find({ expoPushToken: { $ne: null }, isDeleted: false })` — a user whose token never got persisted is silently excluded, with nothing distinguishing "no users to notify" from "everything is broken."
  - Skips a bike entirely (`bikesSkipped++`) if it had zero fuel logs in the current week — by design, but looks identical to "broken" from the outside.
  - Validates each token with `Expo.isExpoPushToken` before building messages; an invalid token increments `notificationsFailed` and `continue`s with **no console output at all** — only visible in the numeric JSON response body of the one-off HTTP call.
  - Calls `expo.sendPushNotificationsAsync(chunk)` per chunk and counts `status === "ok"` as sent — but **never calls `getPushNotificationReceiptsAsync`**, so an `"ok"` ticket only proves Expo _accepted_ the message, not that the device received it. No receipt-checking exists anywhere in this file today.
- `notification.controller.ts`'s `triggerWeeklySummary` is protected only by an `x-cron-secret` header check (`secret !== config.cronSecret` → 401), no JWT — this endpoint can already be called manually (curl/Postman, or the GitHub Actions workflow's `workflow_dispatch`) without waiting for Thursday's schedule; use this for testing.
- `config.cronSecret` reads `process.env.CRON_SECRET`, which is **confirmed absent from the local `.env`** (per spec 21's own implementation notes, left for the user to add) — its presence on the deployed Vercel project has never been re-verified. If it's unset on Vercel, `config.cronSecret` is `undefined` there and the manual test call (and the real cron) will 401.
- `.github/workflows/weekly-summary-cron.yml` builds the target URL as `"${{ secrets.API_BASE_URL }}/cron/weekly-summary"` (no `/api` baked into the workflow) — the `API_BASE_URL` repo secret itself must already include the `/api` prefix (matching `src/app.ts`'s `app.use("/api", MainRouter)`) or every scheduled run 404s. Worth checking the Actions tab's run history for 401/404s as a first, free diagnostic.
- No `EXPO_ACCESS_TOKEN` or Expo-related env var is read anywhere in this codebase (`new Expo()` is called with no options) — this is not the cause of any FCM credential gap; those live on the Expo/EAS project side (`bikelog_app`), not as a server env var. See the paired `bikelog_app` spec 34 for the FCM V1 credentials check, which is out of this repo's scope to fix directly.
- **Root cause found**: a direct, read-only query against the shared database (the same one both local `yarn dev` and the deployed Vercel backend connect to — confirmed in spec 27's own verification notes) found **zero users with a non-null `expoPushToken`**. `sendWeeklySummaries`'s query (`userModel.find({ expoPushToken: { $ne: null }, ... })`) therefore returns an empty array every single run — `usersProcessed: 0`, and the loop that would build/send messages never executes at all. This isn't a bug in this backend's send logic; the pipeline never gets anything to send because no device has ever successfully persisted a token via `POST /auth/push-token`. Per this spec's own Design step 1: "If null/missing, the break is entirely on the `bikelog_app` side (spec 34)" — confirmed. The invalid-token-format skip branch, the per-bike week-skip logic, and Expo ticket/receipt behavior are all **moot** until spec 34 gets a real token registered — there's nothing to validate them against yet.

## Design

### Manual verification (do first, no code — these narrow down which half of the stack is actually broken)

1. Query the test user's document in MongoDB for `expoPushToken`. If `null`/missing, the break is entirely on the `bikelog_app` side (spec 34) — the token never reached this backend at all.
2. Confirm the test bike has ≥1 fuel log inside the current Friday 00:00–Thursday 23:59:59.999 Asia/Dhaka window (`notification.utils.ts`'s `getCurrentWeekRange`) — otherwise it's silently skipped regardless of everything else.
3. Confirm `CRON_SECRET` is set in `bikelog_server/.env` locally **and** in the Vercel project's env vars for the deployed backend, and that it matches whatever secret is used for the manual test call below.

### `src/app/modules/notification/notification.service.ts`

Add minimal diagnostic logging only — no behavior change:

- In the invalid/missing-token skip branch (where `notificationsFailed` is currently incremented with no output): `console.error(\`[weekly-summary] skipping user ${user.\_id}: invalid/missing expoPushToken\`)`.
- After each `sendPushNotificationsAsync(chunk)` call, log each ticket's `status`/`message`/`details` (e.g. `console.log(\`[weekly-summary] ticket:\`, ticket)` per ticket) so a manual trigger's server logs show precisely why a send did or didn't happen for a given token — including Expo-side rejection reasons (`DeviceNotRegistered`, `MessageTooBig`, etc.) that are currently discarded.

No changes to the query, the skip logic, or the send logic itself — this spec is diagnosis-only for the backend half.

## Implementation

1. ✅ `src/app/modules/notification/notification.service.ts` — added the two `console.error`/`console.log` diagnostic points described above (invalid/missing-token skip; per-ticket send result). `yarn build`/`yarn lint` clean (0 errors; 2 new `no-console` warnings, matching this codebase's existing accepted pattern for diagnostic logging elsewhere in this same file and others).
2. ✅ Ran a direct, read-only query against the shared database instead of the HTTP manual trigger — equally authoritative (same predicate `sendWeeklySummaries` itself evaluates: `expoPushToken: { $ne: null }`), and didn't require pulling `CRON_SECRET` off the deployed Vercel project (confirmed absent from local `.env`, and not something to fetch without asking first). Result: **0 users with a non-null `expoPushToken`** — decisive, no ambiguity left to resolve via the live endpoint. (Script was a throwaway, deleted immediately after running — not part of the codebase.)
3. ✅ Cross-checked against the paired `bikelog_app` spec 34: the token was never persisted for any user, so this is entirely a client-side registration problem — spec 34's `eas credentials`/`registerPushToken.ts` diagnostics are where the actual fix has to happen, not here.
4. ✅ `context/progress-tracker.md` — row flipped Not Started → In Progress → Complete (for this spec's own backend-diagnosis scope); root cause documented above and in Recent Activity. **End-to-end delivery confirmation is explicitly not yet possible** and is deferred to whichever of spec 29/34 finishes last — see Verify.

## Dependencies

Paired with `bikelog_app` spec 34 (client-side diagnostics + EAS FCM credentials check) — this spec's manual trigger step is how spec 34's client-side fix gets validated end-to-end. **Not in scope for either spec**: server-side receipt-checking (`getPushNotificationReceiptsAsync`) to auto-null stale tokens, or any other production-hardening beyond making the current failure visible — log as a Known Gap in this tracker if the eventual root cause is something receipt-checking would have caught sooner.

## Verify

- [x] Root cause identified and documented: 0 users in the shared database have a non-null `expoPushToken` — confirmed via direct read-only DB query, decisive and unambiguous.
- [x] `yarn build` clean; `yarn lint` — 0 errors, 16 warnings (2 new, both pre-existing `no-console` rule, same pattern already accepted elsewhere in this file/codebase — baseline was 14).
- [ ] **Blocked on `bikelog_app` spec 34, not fixable here**: manual trigger (`POST /api/cron/weekly-summary` with correct `x-cron-secret`) returning `notificationsSent: 1` for a real user — will still return `usersProcessed: 0` until spec 34 gets a token actually persisted via `POST /auth/push-token`. No value in exercising this endpoint again until that's true.
- [ ] **Blocked on spec 34**: new server logs showing a clean `"ok"` ticket for a real token (no `DeviceNotRegistered`/rejection) — nothing to log yet, no messages are ever built for an empty user list.
- [ ] **Blocked on spec 34**: a real OS notification banner appearing on the test device.
- [ ] **Blocked on spec 34**: foreground receipt and tap-to-deep-link confirmation (owned by spec 34, verified together once a token exists).
- [x] Root cause documented in this file's Context/Implementation, and mirrored into `context/progress-tracker.md`'s Recent Activity + Known Gaps (see below) — no part of the pipeline needed to be intentionally left unfixed to reach this conclusion; receipt-checking remains explicitly out of scope per Dependencies, not because it was needed to diagnose this.

**Next step, owned by `bikelog_app` spec 34**: run `eas credentials -p android` to confirm FCM V1 credentials exist for the EAS project, then add the diagnostic logging spec 34 calls for in `registerPushToken.ts` and actually run the app on the real dev build to see which of that file's three silent-return branches (permission denied, missing `projectId`, or the try/catch around `getExpoPushTokenAsync`/the POST) is where registration is actually failing — that's the real, still-open question this backend-side investigation could not answer on its own.
