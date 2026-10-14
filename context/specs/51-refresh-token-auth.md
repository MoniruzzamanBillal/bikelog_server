# 51: Refresh-token auth — short-lived access token + 15-day refresh token

Status: ✅ **Complete — implemented 2026-10-11.** Every step of §C is ticked below. Verified 31/31 against a locally-run server on the live Neon DB with every DB call read-only (§G's results are recorded in `context/progress-tracker.md`'s Recent Activity, including the three cases that still need two throwaway accounts: V1's login response, V10's soft-deleted user, and V15). One defect surfaced during implementation and is fixed in its own sub-spec, **`51a-verify-side-token-claims-shape.md`** — §C steps 2 and 8 as written here are mutually incompatible, and `yarn build` is the only reason it was caught. **Not deployed:** `JWT_REFRESH_SECRET` must be set in Vercel first (§B), and §H ships the clients before the server.

Written 2026-10-11 at the developer's request and revised the same day as they answered its open questions; all five answers are in **Decisions** at the end.

Master spec for a three-repo change. The client halves are `bikelog_client-web-` spec 32 and `bikelog_app` spec 51; both depend on §A (the wire contract) and §0 (the hazards) of this file and should not be started before this one is agreed.

---

## Goal

Replace the current single long-lived token with a standard two-token scheme:

- **Access token** — 15 minutes, sent as `Authorization: Bearer <token>` exactly as today.
- **Refresh token** — 15 days, held by the client, exchanged for a new access token at `POST /api/auth/refresh-token`.
- When the refresh token itself is invalid or expired, the server answers `401` and the client logs the user out.
- **Neither token is stored in the database.** Both are self-contained JWTs; the server keeps no session table, no denylist and no "current refresh token" column. This is a deliberate constraint from the developer, and §0 H3 + §F record exactly what it costs.

Today's behaviour, for contrast: `loginFromDb` signs one token with `JWT_ACCESS_SECRET` and `config.jwt_expires_in` (default `"10d"`), and `authCheck` verifies it. There is no refresh path at all, so a session simply dies after 10 days and every client treats a `401` as "log out now".

---

## 0. Hazards — read before writing any code

**H1 — old app builds meet 15-minute tokens. SETTLED 2026-10-11: single-phase rollout, no staging.**
`bikelog_app` ships as an APK/EAS build, and an install that predates this spec has no refresh logic — it holds one token and logs out on the first `401`. So a server issuing 15-minute access tokens logs out every user still on an old build, every 15 minutes.

**The developer has confirmed every user will install the new app build**, so this is no longer a reason to stage anything. An earlier draft of this spec carried a three-phase runbook (deploy at `JWT_ACCESS_EXPIRES_IN=10d`, ship the clients, then flip to `15m`); it has been **dropped**. §H is now one deploy.

Two things survive from it, and only these:

- **Deploy the server last**, once both client builds exist and are ready to go out. That keeps the window in which an old install can meet a short token down to minutes. It is sequencing, not phasing — no env var changes mid-rollout.
- **Keep the lifetime in an env var anyway** (`JWT_ACCESS_EXPIRES_IN`, §B). It is the rollback lever (set `10d`, redeploy — see §H) and it is how §G's test plan reaches expiry in 60 seconds instead of 15 minutes.

**H2 — a 15-minute access token turns `error_logs` into a firehose, and the write is awaited.**
`globalErrorHandler` persists _every_ error, `401`s included, with an **awaited** `errorLogServices.createErrorLog` (deliberately awaited — see its comment about Vercel tearing down an invocation after the response flushes). Today a `401` is rare. With 15-minute tokens every client hits one roughly every 15 minutes of use, and because several screens fetch at once, each expiry produces a _burst_ of them — plus one more per failed refresh. Each row costs a Neon round trip on the request's critical path, and the daily cleanup cron only sweeps rows older than 30 days.

§E is the decision on what to do about it, and the developer has chosen the narrow rule: a `401` from the refresh route is **never** logged (its request body is a live credential), while an access-token `401` **is** logged, with no token material in the row. So this hazard is **accepted rather than closed** — §E's "What this costs" spells out the latency, volume and signal consequences, and keeps the flat `401` skip on record as the fallback if they bite.

**H3 — no database storage means no revocation.** Accepted, but state it plainly:

- A leaked refresh token is valid for its full 15 days and cannot be killed.
- "Log out" is client-side only. Clearing the client's storage does not invalidate the token; anyone holding a copy can keep refreshing.
- A password change does not end other sessions.
- `isDeleted` is the one lever that does work, because refresh re-reads the user row (§A, H6).

§F records the cheapest upgrade path (a `tokenVersion` integer on `User` — a counter, not a token) if revocation is ever wanted.

**H4 — one secret for both token types is a real vulnerability.** With a shared secret, an access token is a structurally valid refresh token: a 15-minute token could be replayed at `/auth/refresh-token` forever. Two defences, both required: a separate `JWT_REFRESH_SECRET`, **and** a `type: "access" | "refresh"` claim that each verifier asserts.

**H5 — `src/app/config/index.ts` is a protected area** (`context/ai-workflow-rules.md`): its key names are read from several places and renaming one is a breaking change. Add keys; do not rename or remove `jwt_secret` / `jwt_expires_in`.

**H6 — a soft-deleted user can log in today.** `loginFromDb` queries `prisma.user.findUnique({ where: { email } })` and never looks at `isDeleted`. So `isDeleted` currently does nothing for auth. The refresh path must check it (otherwise a deleted user's session renews for 15 days), and since the same one-line check belongs on login, it is in scope here. Flagging it as a pre-existing defect found while writing this spec, not as scope creep.

**H7 — login's error statuses must not be "tidied up".** `loginFromDb` answers an unknown email with `404` and a wrong password with `403`, never `401`. Both clients key their session-expiry handling on `401`, and `bikelog_app` spec 48a's stale-401 rule depends on login _not_ producing one. Leave them.

**H8 — the `type` claim must be optional on verify, or the deploy logs everyone out.** Tokens issued before this change carry no `type` claim. If `authCheck` requires `type === "access"`, every currently-valid token (up to 10 days' worth) is rejected at deploy. Treat a _missing_ `type` as `"access"` (legacy) and reject only an explicit mismatch. The legacy tolerance can be dropped in a later spec once 10 days have passed since the deploy — note it in the tracker rather than leaving it to be rediscovered.

---

## A. Wire contract

### `POST /api/auth/login` (changed, additively)

```json
{
  "success": true,
  "message": "User logged in successfully!!!",
  "data": null,
  "token": "<access token, 15m>",
  "refreshToken": "<refresh token, 15d>"
}
```

`token` keeps meaning **the access token**. That is the whole back-compat story for H1: both existing clients read `result.token` and keep working untouched. `refreshToken` is a new sibling field, ignored by old builds.

### `POST /api/auth/refresh-token` (new)

- **No `authCheck`** — the caller has no usable access token by definition.
- Body: `{ "refreshToken": "<token>" }`, validated by a new zod schema.
- 200:

```json
{
  "success": true,
  "message": "Access token refreshed successfully!!!",
  "data": null,
  "token": "<new access token, 15m>"
}
```

- The refresh token is **not** echoed back and **not** rotated — per the developer's instruction, it stays the same until it expires. Nothing for the client to store, and it keeps the token out of one more response body/log line. §F notes what rotation would buy.
- `401` for: malformed, bad signature, expired, `type !== "refresh"`, user no longer exists, user `isDeleted`. One shared message (`"Invalid or expired refresh token"`) so the response cannot be used to probe which case it was.
- `400` from `validateRequest` if `refreshToken` is missing or not a string.

### Claims

|             | access                          | refresh                          |
| ----------- | ------------------------------- | -------------------------------- |
| `userId`    | ✅                              | ✅                               |
| `userEmail` | ✅                              | ❌                               |
| `userRole`  | ✅                              | ❌                               |
| `type`      | `"access"`                      | `"refresh"`                      |
| lifetime    | `JWT_ACCESS_EXPIRES_IN` (`15m`) | `JWT_REFRESH_EXPIRES_IN` (`15d`) |
| secret      | `JWT_ACCESS_SECRET`             | `JWT_REFRESH_SECRET`             |

The refresh token deliberately carries **only** `userId` + `type`. The new access token is minted from the freshly-read `User` row, not copied from the refresh token's claims — so a role or email change propagates to the token within one access-token lifetime, and a soft delete takes effect at the next refresh. Keep refresh claims minimal; they live on the client for 15 days.

### The client flow this contract exists to serve (normative, confirmed 2026-10-11)

Both client specs implement exactly this and nothing more. It is recorded here, in the master spec, so the two clients cannot drift:

1. The client sends a request with whatever access token it holds. **It does not inspect `exp` to decide whether to send.**
2. The access token is expired → **this server answers `401`** (`authCheck`, message `"Access token expired"` after §C step 8).
3. The client posts the refresh token to `POST /api/auth/refresh-token`.
   - **Valid** → `200` with a new access token; the client stores it, retries the original request, and the user sees nothing.
   - **Invalid or expired** → **`401`** → the client logs the user out and **removes both the access token and the refresh token**.
4. One exception to "react, never predict", and it is not an expiry check: with **no** access token at all there is nothing to put in the header, so this server would answer "Authorization header missing or malformed" rather than the expired-token `401` the flow reacts to. In that one case the client refreshes first.

Two server-side consequences worth keeping in view while implementing §C:

- **Step 3 must be answerable without an access token.** That is why the route carries no `authCheck`, and why a `401` from it has to be unambiguous — hence the single shared message in §A, and the deliberate choice in §C step 3 to answer "user deleted" and "signature bad" identically.
- **Step 2 is now a routine event, not an error.** Every active client produces one per expiry window. That is H2 — and per §E those `401`s are still written to `error_logs` (only the refresh route's are skipped), so each one costs an awaited Neon write before the `401` even reaches the client. Step 3b's `401`, by contrast, is never logged: its request body is a live refresh token.

### Not added

- **No `POST /auth/logout`.** With nothing stored server-side there is nothing to invalidate, so an endpoint would be a lie. Logout stays client-side in both clients.
- **No change to `POST /auth/register`.** Neither client auto-logs-in after register (both redirect to the login screen), so register issues no tokens today and still doesn't.
- No cookie set by the server. The web client holds its tokens in cookies it sets itself — see §F for why `httpOnly` is not on the table here.
- No change to `GET /auth/me` or `POST /auth/push-token`.
- No CORS change: the refresh token travels in the body, and `Authorization` is already in `allowedHeaders`.

---

## B. Config and env

Add to `src/app/config/index.ts` (keys only, per H5):

```ts
jwt_refresh_secret: process.env.JWT_REFRESH_SECRET,
jwt_access_expires_in: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
jwt_refresh_expires_in: process.env.JWT_REFRESH_EXPIRES_IN || "15d",
```

- `jwt_secret` (`JWT_ACCESS_SECRET`) keeps its meaning: the access-token secret.
- `jwt_expires_in` (`JWT_EXPIRES_IN`, default `"10d"`) loses its last consumer and becomes **vestigial**, like `mongo_database_url`. Leave the key in place (H5) with a comment saying so; the Vercel variable can be deleted in a later cleanup, and until then it is harmless — nothing reads it. The rollback lever is `JWT_ACCESS_EXPIRES_IN`, not this.
- Defaulting `jwt_access_expires_in` to `15m` means `15m` is what production gets without the variable being set at all, and that a forgotten env var fails _safe_ (short tokens) — which is also what a fresh clone wants. The variable exists for the 60-second test runs in §G and as the rollback lever in §H.

**Boot-time guard** in `src/server.ts`, before `prisma.$connect()`: throw if `jwt_refresh_secret` is missing or equal to `jwt_secret`. A silently-missing refresh secret would make `Jwt.sign(payload, undefined)` throw per request instead of once at boot, and an equal secret is H4. Failing at boot is the only place this is cheap to notice.

Update `ENV_SETUP.md` in the same change (it carries its own "Corrected 2026-10-01" banner — keep that habit and date the new entries).

---

## C. Server implementation

1. ✅ **`src/app/config/index.ts`** — the three keys above, plus the "vestigial" comment on `jwt_expires_in`.
2. ✅ **`src/app/modules/user/user.interface.ts`**
   - `TJwtPayload` gains `type?: "access"` — **optional**, per H8.
   - New `TRefreshPayload = { userId: string; type: "refresh"; iat?: number; exp?: number }`.
   - No change needed in `src/app/interface/index.d.ts`; `Request.user` stays `TJwtPayload`.
3. ✅ **`src/app/modules/user/user.services.ts`**
   - Two private helpers, so sign-time and verify-time shapes cannot drift (the same reasoning spec 02 used for typing `jwtPayload`):
     - `signAccessToken(user: { id; email; userRole })` → `Jwt.sign({ userId, userEmail, userRole, type: "access" }, config.jwt_secret, { expiresIn: config.jwt_access_expires_in })`
     - `signRefreshToken(user: { id })` → `Jwt.sign({ userId, type: "refresh" }, config.jwt_refresh_secret, { expiresIn: config.jwt_refresh_expires_in })`
   - `loginFromDb` returns `{ accessToken, refreshToken }` instead of a bare string. Add the `isDeleted` check (H6): a soft-deleted user gets the same `404 "User dont exist with this email !!!"` as a missing one, so the response doesn't distinguish "deleted" from "never existed".
   - New `refreshAccessToken(refreshToken: string)`:
     1. `Jwt.verify(refreshToken, config.jwt_refresh_secret)` inside try/catch → on throw, `AppError(401, "Invalid or expired refresh token")`.
     2. Assert `decoded?.type === "refresh"` → else the same 401. (Required here, unlike H8's tolerance: no refresh token has ever been issued, so there is no legacy shape to accommodate.)
     3. `prisma.user.findUnique({ where: { id: decoded.userId }, select: { id, email, userRole, isDeleted } })` → missing or `isDeleted` → the same 401.
     4. Return `{ accessToken: signAccessToken(user) }`.
   - This DB read is the one unavoidable query on the refresh path. It is what makes soft delete and role changes effective, so don't "optimise" it away.
4. ✅ **`src/app/modules/user/user.validation.ts`** — `refreshTokenSchema = z.object({ body: z.object({ refreshToken: z.string({ required_error: "refreshToken is required" }).min(1, ...) }) })`, exported on `userValidations`.
5. ✅ **`src/app/modules/user/user.controller.ts`**
   - `signIn` sends `token: result.accessToken` and `refreshToken: result.refreshToken`.
   - New `refreshToken` controller → `sendResponse(res, { status: 200, success: true, message: "Access token refreshed successfully!!!", data: null, token: result.accessToken })`.
6. ✅ **`src/app/modules/user/user.route.ts`** — `router.post("/refresh-token", validateRequest(userValidations.refreshTokenSchema), userController.refreshToken)`, placed with the other public routes, **without** `authCheck`. Add a comment saying the omission is deliberate (the same convention `notification.route.ts` uses for the cron routes).
7. ✅ **`src/app/util/sendResponse.ts`** — add `refreshToken?: string` to `Tresponse<T>` and to the JSON body. Note it will serialise as `undefined`→absent for every other endpoint, exactly like `token` does today.
8. ✅ **`src/app/middleware/authCheck.ts`**
   - After `Jwt.verify`, reject an explicit `decoded?.type === "refresh"` with `401` (H4). Missing `type` passes (H8).
   - Split the catch: `error instanceof Jwt.TokenExpiredError` → `401 "Access token expired"`; anything else → `401 "Invalid access token"`. Both stay `401` so no client behaviour changes, but the message tells an expired token apart from a malformed one in logs and in the clients' error toasts. Keep the missing-header branch as it is — `bikelog_app` spec 48a's write-up quotes its exact message, so changing the text would invalidate that record.
9. ✅ **`src/app/middleware/globalErrorHandler.ts`** — §E.1's path-based skip. Nothing else: §E.2 is a constraint on what *not* to add, not code to write.
10. ✅ **Postman** (`postman/bikelog-api.postman_collection.json`) — under _Auth_: a `Refresh Access Token` request that posts `{{refreshToken}}`, plus a negative case with a garbage token (expect 401). The existing _Login_ requests need a test script capturing `refreshToken` into the collection variable alongside the existing token capture (there is already a `Login as User B (captures {{tokenB}})` to copy the pattern from). Add `refreshToken` to `postman/dummy-data.md` if it documents the login response shape.
11. ✅ **Docs** — `context/progress-tracker.md` (row + Current Phase + Recent Activity), `CLAUDE.md` (its auth description and env list), `ENV_SETUP.md`, and `context/architecture.md` if it describes the auth flow. `context/code-standards.md` if it states "one token".

---

## D. What this does _not_ change on the server

- `adminCheck`, every module's ownership scoping, and every `req.user.userId` read — the access token's claims are a superset of today's, so nothing downstream moves.
- The cron routes (`x-cron-secret`), which never carried a JWT.
- The `expenseTracker2` integration (`EXPENSE_TRACKER_INTEGRATION_KEY`), which is its own shared-secret scheme.
- `GET /api/admin/error-logs`' gating.

---

## E. What `error_logs` records about auth failures (decided by the developer 2026-10-11)

Two rules, and they differ per route:

### E.1 — A `401` from `POST /api/auth/refresh-token` is never logged

```ts
// ! Spec 51 §E.1: the request body of this route holds a LIVE 15-day credential. Nothing
// ! about a refresh failure may reach `error_logs`, because that table is read back through
// ! an admin HTTP endpoint (GET /api/admin/error-logs, web spec 26) and kept for 30 days.
// ! A refusal here is also not information: the only answer the route ever gives is the one
// ! shared "Invalid or expired refresh token" (§A), by design.
const isRefreshTokenFailure = status === 401 && req.path.endsWith("/auth/refresh-token");
```

Skip the `createErrorLog` write entirely when this is true. Match on the path, not the message — the message is deliberately identical across every failure cause, so it cannot distinguish anything, while the path is exact.

### E.2 — A `401` from `authCheck` is logged, but carries no token material

Access-token failures stay in the log. The constraint is that the row must never contain the token, the `Authorization` header, or the request body.

**Good news, and it needs saying precisely: the `ErrorLog` model has no field that could hold any of them.** `prisma/schema.prisma` gives it `status`, `message`, `errorName`, `errorSources`, `stack`, `method`, `path`, `userId`, `userEmail`, `createdAt` — and `TErrorLog` in `errorLog.interface.ts` mirrors that exactly. There is no `body`, no `payload`, no `headers`. So "don't store the payload" is already true today; what this spec owes is **keeping** it true, which means three things:

1. **Do not extend `TErrorLog` or the `ErrorLog` model** with a body/headers/token field as part of this work, however tempting it looks while debugging a refresh problem. If a payload really is needed to diagnose something, log it to `console`/`morgan` for one deploy, never to the table.
2. **Verify the three strings `authCheck` can produce carry nothing** — `"Authorization header missing or malformed"`, `"Access token expired"`, `"Invalid access token"`. None interpolates the token today and none may start to. In particular, do not "improve" the message by appending the offending token, which is a common debugging reflex.
3. **Check the `400` path too.** A malformed `POST /auth/refresh-token` body is a Zod `400`, not a `401`, so E.1 does not catch it and it will be logged. `handleZodError` builds `errorSources` from issue `path` + `message`, which for this schema means `["body", "refreshToken"]` plus a type/length complaint — no received value. Confirm that by eye during implementation (V12a) rather than assuming; if any Zod message ever did echo a value, E.1's skip would have to widen to every status on that route.

### What this costs, so it is a known trade and not a surprise

H2 is **accepted, not closed.** Access-token `401`s are the common case by a wide margin — E.1 only removes the rare failed refresh — so the firehose H2 describes still arrives:

- **Latency, on the path that matters most.** `createErrorLog` is `await`ed (deliberately — see its comment about Vercel tearing down an invocation after the response flushes). So every expired-token request now pays an extra Neon round trip *before* its `401` comes back, which in turn delays the client's refresh and its retry. The user-visible cost of an expiry window grows by that round trip.
- **Volume.** Rough order of magnitude at ~16 users: a 15-minute token means ~4 expiry windows per hour of use, each producing one `401` per in-flight query, so a few hundred rows a day, standing at a few thousand under the 30-day retention. Not dangerous for Postgres; the `@@index([status, createdAt])` keeps the admin list fast.
- **Signal.** The admin dashboard's unfiltered list becomes mostly routine `401`s, so a real fault is harder to spot. The method filter already exists; a status filter (or defaulting the list to `status >= 500`) would be a small web-side follow-up — **not** in this spec, and worth deciding only after seeing a day of real volume (§H step 6).

If any of those turns out to bite, the fallback is the flat `status !== 401` skip that an earlier draft of this spec recommended: one line, no schema change, reversible. Recorded here so the option is not lost.

### Unchanged

Everything that is not a `401` keeps being logged exactly as today — `adminCheck`'s `403`, `404`s, the catalogs' `409`s, every `500`.

---

## F. Deliberately out of scope — and what each omission costs

| Not doing                                                                                       | What it would buy                                                                                                                                                                          | Why not now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Refresh-token **rotation** (new refresh token on every refresh)                                 | Reuse detection: a stolen token used twice is detectable                                                                                                                                   | The developer specified the refresh token stays the same. Without server-side storage, rotation also _cannot_ detect reuse — detection needs the last-issued token on record. Rotation without storage is churn with no security gain, so this is the right call given the no-DB constraint                                                                                                                                                                                                     |
| `tokenVersion Int @default(0)` on `User`, minted into the refresh token and compared on refresh | Real revocation: "log out all devices", kill sessions on password change, bump on suspected leak — at the cost of one integer, **not** token storage, so it respects the no-DB-tokens rule | Not asked for; it needs a migration and a place in the UI to trigger it. This is the recommended follow-up if H3 ever matters                                                                                                                                                                                                                                                                                                                                                                   |
| Server-set `httpOnly` cookies                                                                   | XSS could not read the tokens                                                                                                                                                              | The API (`bikelog-server.vercel.app`) and the web client (`bikelog-web.vercel.app`) are different sites, so an auth cookie would be a third-party cookie needing `SameSite=None; Secure` — which Safari's ITP already blocks and Chrome's third-party-cookie work keeps eroding. It also would not help `bikelog_app` at all. The developer's choice (client-held cookies on web, device storage on app) is the pragmatic one here; the cost is that an XSS in the web client reads both tokens |
| `/auth/logout` + denylist                                                                       | Server-side session kill                                                                                                                                                                   | Needs storage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Rate limiting on `/auth/refresh-token`                                                          | The one new unauthenticated endpoint that does a DB read is also the one an attacker can hammer for free                                                                                   | No rate-limiting infrastructure exists anywhere in this server; adding it for one route is its own spec. Worth noting the endpoint is cheap (one `Jwt.verify` + one indexed `findUnique`, no argon2)                                                                                                                                                                                                                                                                                            |
| Password reset / email verification                                                             | —                                                                                                                                                                                          | Never specified; untouched by this spec                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Sliding/absolute session caps                                                                   | A 15-day refresh token is renewable indefinitely only by re-login — fine                                                                                                                   | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

---

## G. Test plan

Postman (local `yarn dev` against a Neon branch — the `PrismaNeon` adapter cannot use local Postgres). Run with `JWT_ACCESS_EXPIRES_IN=60s` so expiry is observable without waiting 15 minutes, then once more with `15m`.

| #   | Scenario                                                                                                         | Expected                                                                                                                                                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | `POST /auth/login`, valid credentials                                                                            | 200; `token` and `refreshToken` both present; decoding shows `type: "access"` / `type: "refresh"`, the access token's `exp - iat` = 60s, the refresh token's = 15d, and the refresh token carries **no** `userEmail`/`userRole` |
| V2  | Protected `GET /bikes` with the fresh access token                                                               | 200                                                                                                                                                                                                                             |
| V3  | Same call 70s later                                                                                              | 401 `"Access token expired"`                                                                                                                                                                                                    |
| V4  | `POST /auth/refresh-token` with the refresh token                                                                | 200; new `token`; no `refreshToken` in the body; the new token works on `GET /bikes`                                                                                                                                            |
| V5  | `POST /auth/refresh-token` with no body / `{}` / `{"refreshToken": 123}`                                         | 400 from `validateRequest`                                                                                                                                                                                                      |
| V6  | `POST /auth/refresh-token` with garbage, with a token signed by the access secret, and with the **access** token | 401 `"Invalid or expired refresh token"` in all three (H4)                                                                                                                                                                      |
| V7  | `POST /auth/refresh-token` with a refresh token signed with `expiresIn: "1s"`, after 2s                          | 401                                                                                                                                                                                                                             |
| V8  | Present the **refresh** token as `Authorization: Bearer` on `GET /bikes`                                         | 401 (H4)                                                                                                                                                                                                                        |
| V9  | A token issued _before_ this change (sign one by hand with no `type` claim, access secret) on `GET /bikes`       | 200 — H8's legacy tolerance                                                                                                                                                                                                     |
| V10 | Soft-delete the user (`UPDATE users SET "isDeleted" = true`), then refresh                                       | 401; and `POST /auth/login` for that user → 404 (H6)                                                                                                                                                                            |
| V11 | Refresh twice with the same refresh token                                                                        | both 200 — no rotation, by design                                                                                                                                                                                               |
| V12 | Count `error_logs` rows after V6+V7 (the refresh-route `401`s) | unchanged — **zero** rows written for a refused refresh (§E.1) |
| V12a | `POST /auth/refresh-token` with `{"refreshToken": 123}` and with `{}`, then read the resulting `400` rows via `GET /admin/error-logs` | rows exist (a `400` is not a `401`), and neither `message`, `errorSources` nor `stack` contains any part of a token — `errorSources` should be a `["body", "refreshToken"]` path plus a type/length complaint (§E.2 item 3) |
| V12b | Trigger V3's expired-token `401`, then read its row | the row **is** written (§E.2), and `message` is `"Access token expired"` with no token text anywhere in `message`, `errorSources`, `stack` or `path` |
| V13 | `GET /admin/error-logs` after forcing a `403` from `adminCheck` and a `409` from a duplicate catalog name | both still logged — the only skip is the refresh route's `401` |
| V14 | Boot with `JWT_REFRESH_SECRET` unset, then with it equal to `JWT_ACCESS_SECRET`                                  | server refuses to start in both cases (§B)                                                                                                                                                                                      |
| V15 | Two accounts: A refreshes, then B refreshes with A's refresh token                                               | each gets a token for their own `userId`; B's new token cannot read A's bikes                                                                                                                                                   |

Also the standing checklist: `yarn build`, `yarn lint` with no _new_ findings, and the ownership item in `context/ai-workflow-rules.md` (nothing here touches owner scoping, but say so explicitly in the tracker).

---

## H. Rollout runbook (single phase — see H1)

**Before merge.** Generate a refresh secret distinct from the access secret (`openssl rand -hex 48`). Put it in local `.env` and in Vercel — Production **and** Preview, since `branch-build.yml`/`pr-checks.yml` only build, but a preview deploy would boot and now hard-fails without it (§B's boot guard).

**Order of operations.** Build the clients first, deploy the server last (H1):

1. `bikelog_client-web-` spec 32 and `bikelog_app` spec 51 implemented, verified, and in the case of the app **built** and ready to distribute. Both are safe against today's server: they store a `refreshToken` that simply isn't there yet, and §A keeps `token` meaning the access token so neither client changes behaviour until the server does.
2. Set on Vercel: `JWT_REFRESH_SECRET=<new>`. `JWT_ACCESS_EXPIRES_IN` can be left unset — it defaults to `15m` (§B). Leave `JWT_EXPIRES_IN` in place as a no-op; it is the rollback marker and the §B cleanup removes it later.
3. Merge the server to `master` (`deploy.yml` deploys, `release.yml` tags).
4. Verify against production with a throwaway account: V1–V4 and V12 from §G.
5. Ship the web client, distribute the app build. Tell users to update — an un-updated install now gets a 15-minute session (H1).
6. Watch `error_logs` for a day. The daily count **will rise** — per §E the access-token `401`s are kept on purpose — so what to check is that no row came from the refresh route (§E.1) and that none carries token material (§E.2). Then decide, with a real day's volume in hand, whether the admin dashboard needs a status filter or whether the flat `401` skip is wanted after all. Both are recorded in §E.

**Rollback:** set `JWT_ACCESS_EXPIRES_IN=10d` on Vercel and redeploy. Already-issued tokens keep their baked-in `exp`, so the worst case is one 15-minute window of short tokens — which the new clients handle anyway, and which is exactly the pre-spec-51 behaviour for anyone who hasn't updated. No migration, no data change: this spec has **zero** schema impact, which is the one thing it has over spec 46.

---

## Decisions (answered by the developer, 2026-10-11)

1. **Every app user will install the new build.** H1 is settled and §H is a single deploy — see H1 for the two things that survived from the phased plan.
2. **Access token = 15 minutes.** `JWT_ACCESS_EXPIRES_IN` defaults to `15m`, so the variable does not need setting in production at all; it stays configurable as the rollback lever and for §G's 60-second test runs.
3. **Endpoint = `POST /api/auth/refresh-token`.** Confirmed. It lives in the `user` router next to `/auth/login` and `/auth/register` (`app.use("/api", MainRouter)` supplies the `/api` prefix), so `router/index.ts` needs no change.
4. **The client flow is reactive** — send the token, let the server `401`, refresh, retry; log out and drop both tokens only when the refresh itself is refused. Recorded normatively in §A; both client specs implement exactly it.
5. **`error_logs`:** nothing from a refused refresh is logged at all, and an access-token `401` is logged without any token material. §E, with the costs that choice accepts spelled out there. The `ErrorLog` model already has no body/headers/payload column, so the second half is an invariant to protect rather than code to write.

Nothing is open on the server side. The one judgement call left for later is whether the admin dashboard wants a status filter once a day of real `401` volume has been seen (§E, §H step 6) — a web-side follow-up, not part of this spec.
