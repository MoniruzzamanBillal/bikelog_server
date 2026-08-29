# 24: Automatic Error Logging System (30-Day Rolling Retention, Admin-Only Read Access)

Status: ✅ Complete

## Goal

Today, when a request fails, `globalErrorHandler.ts` formats it and sends the response — the error itself is never persisted anywhere. There's no way to answer "what errors have users actually hit?" after the fact except by asking the user or re-reading server logs that (on Vercel serverless) aren't reliably retained. This spec adds automatic, zero-effort error logging: every error that already flows through `globalErrorHandler` gets persisted to a new `ErrorLog` collection, kept on a **rolling 30-day window** (today minus 29 days through today — e.g. if today is Jan 30, the stored range is Jan 1–30; the moment Jan 31 begins, the Jan 1 entries age out automatically), with a single admin-only endpoint to list/inspect them. No manual delete endpoint — expiry is fully automatic via a MongoDB TTL index, per the user's explicit "the error delete will be automatic" requirement.

## Context

- **`globalErrorHandler.ts` is already the single choke point for every error in this app** — `AppError`, `ZodError`, Mongoose `ValidationError`/`CastError`, Mongo duplicate-key (code `11000`), and any unclassified thrown error all funnel through it before a response is sent (`src/app/middleware/globalErrorHandler.ts`). This is the same "single choke point" shape this codebase already uses elsewhere (`askOpenRouter` in `openRouterClient.ts` per `CLAUDE.md`) — hooking the new logging into this one file, rather than sprinkling logging calls across every service, is the natural fit and requires touching exactly one existing file.
- **One documented exception**: `app.ts`'s trailing 404 handler (`app.use((req, res) => res.status(404).json(...))`) responds directly and never calls `next(error)`, so it never reaches `globalErrorHandler` — a request for a nonexistent route/path won't be captured by this system. Flagged as a known, accepted gap (out of scope for this pass; see "Not covered" below).
- **`userRole` exists but has never been read anywhere.** `TUserRole = "admin" | "user"` (`user.interface.ts`) is already on `TUser`/`TJwtPayload` and embedded into the JWT at login (`user.services.ts`), added back in spec 02 purely as forward-compatible scaffolding — `bikelog_server/CLAUDE.md`'s own architecture notes call this out explicitly ("nothing reads it today"). This spec is the first real consumer: a new `adminCheck` middleware, mirroring `authCheck`'s shape, that 403s any request whose `req.user.userRole !== "admin"`.
- **No admin-promotion endpoint exists and this spec doesn't add one** — flagged as an explicit scope boundary, not an oversight. Every user registers as `"user"` (`UserRole.user` default in `user.model.ts`). Promoting yourself/another account to `"admin"` is a one-time manual DB write (e.g. `db.users.updateOne({email: "..."}, {$set: {userRole: "admin"}})` via Compass/mongosh) until a dedicated endpoint is scoped in a future spec. **Important corollary**: since `userRole` is baked into the JWT at login time and tokens live up to `JWT_EXPIRES_IN` (default `10d`), a role change only takes effect the _next time that user logs in_ — an already-issued token keeps its old role until it expires or the user re-authenticates. Worth remembering when testing this feature.
- **Serverless write-ordering gotcha (the one real correctness risk in this design)**: this backend deploys to Vercel serverless (`vercel.json` → `dist/server.js`, per `CLAUDE.md`'s Deployment note), where a function invocation can be frozen/torn down essentially as soon as the response is flushed. A fire-and-forget (`.then()`/un-awaited) DB write issued _after_ `res.status(status).json(...)` is not guaranteed to complete — it can be silently dropped. So the error-log write must be `await`ed **before** `globalErrorHandler` sends its response, not after. This adds a small amount of latency to every error response (one extra DB round-trip), which is an accepted, deliberate tradeoff for actually-reliable logging over shaving a few ms off error responses.
- **The log write must never itself produce a second unhandled failure.** If Mongo is down, or the log document somehow fails its own validation, the _original_ error still has to reach the client normally. The write is wrapped in its own `try/catch` inside `globalErrorHandler` — a failure to log is swallowed (logged to `console.error`, matching this repo's existing tolerated `no-console` pattern in `server.ts`/`notification.service.ts`) and never re-thrown or passed to `next()` (which would recurse back into this same handler).
- **Route namespace — flagged judgment call.** This is the first admin-only resource in the codebase, so there's no existing `/admin` prefix to follow. Recommended: mount under a new top-level `/admin` prefix (`GET /admin/error-logs`, `GET /admin/error-logs/:id`) so any future admin-only endpoint has an obvious home, rather than a bare `/error-logs` that reads like a public/user resource until you check its middleware. Pick the flat `/error-logs` form instead if you'd rather not commit to an `/admin` namespace yet — the rest of this spec assumes the recommended `/admin/error-logs` form.

## Design

### 1. New `adminCheck` middleware (`src/app/middleware/adminCheck.ts`)

Mirrors `authCheck.ts`'s shape (`catchAsync`-wrapped, throws `AppError`). Must run **after** `authCheck` in the route chain, since it reads `req.user` (populated by `authCheck`):

```ts
const adminCheck = catchAsync(async (req, res, next) => {
  if (req.user?.userRole !== UserRole.admin) {
    return next(new AppError(httpStatus.FORBIDDEN, "Admin access required"));
  }
  next();
});
```

Reusable for any future admin-only route, not just this one.

### 2. New `errorLog` module (`src/app/modules/errorLog/`)

Following the module-per-feature layout every other module uses (`.model.ts` / `.interface.ts` / `.controller.ts` / `.service.ts` / `.route.ts`; no `.validation.ts` needed — this module has no client-writable input, see below).

**`errorLog.interface.ts`**

```ts
export type TErrorLog = {
  status: number;
  message: string;
  errorName?: string; // error.name / error.constructor.name — "AppError", "ZodError", "ValidationError", "CastError", "MongoServerError", "Error", etc.
  errorSources?: TerrorSource; // reused as-is from ../../interface/error
  stack?: string;
  method: string; // req.method
  path: string; // req.originalUrl
  userId?: string | null; // req.user?.userId, when the failing request was authenticated
  userEmail?: string | null; // req.user?.userEmail — convenience for support, avoids a join back to User for the common case
};
```

`createdAt`/`updatedAt` come from `{ timestamps: true }`, same as every other model — `createdAt` is what the TTL index expires against (see below), which is correct here: an error log is authored once and never edited, so `createdAt` and "when this happened" are the same instant (unlike `FuelLog.date`/`MaintenanceLog.serviceDate`, this schema has no separate user-editable event-date field to prefer).

**`errorLog.model.ts`**

```ts
const errorLogSchema = new Schema<TErrorLog>(
  {
    status: { type: Number, required: true },
    message: { type: String, required: true },
    errorName: { type: String },
    errorSources: [{ path: Schema.Types.Mixed, message: String, _id: false }],
    stack: { type: String },
    method: { type: String, required: true },
    path: { type: String, required: true },
    userId: { type: String, default: null },
    userEmail: { type: String, default: null },
  },
  { timestamps: true },
);

// ! rolling 30-day retention — MongoDB's TTL monitor deletes a document once
// ! (createdAt + 30 days) is in the past; runs as its own background sweep
// ! (default ~60s period), not something the app has to trigger itself.
errorLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 30 },
);

// ! supports the default admin list sort (-createdAt) and status-filtered lookups efficiently
errorLogSchema.index({ status: 1, createdAt: -1 });

export const errorLogModel = model<TErrorLog>("ErrorLog", errorLogSchema);
```

No `isDeleted`/soft-delete, no `pre("find")` hooks — this collection isn't user-owned data and doesn't participate in that pattern; deletion is exclusively the TTL sweep.

**`errorLog.service.ts`**

- `createErrorLog(payload: TErrorLog)` — plain `errorLogModel.create(payload)`. Called only from `globalErrorHandler`.
- `getErrorLogsFromDB(query: Record<string, unknown>)` — same `Queryuilder` pattern every other list endpoint uses: `new Queryuilder(errorLogModel.find(), query).filter().sort().pagination().field()`, default sort `-createdAt` (Queryuilder's own default when no `?sort=` is supplied). `status` and `method` are usable as exact-match filters for free through `.filter()` (Mongoose casts the query-string `status` value against the schema's `Number` type automatically, same as every existing exact-match filter in this codebase, e.g. `bikeIssue`'s `status` query param). Returns `{ result, meta: { page, limit, total } }`, matching the paginated-list shape already used by `fuelLog`/`maintenanceLog`/`bikeIssue`/`bikeAccessory`.
- `getErrorLogByIdFromDB(id: string)` — plain `errorLogModel.findById(id)`, throws `AppError(404, "Error log not found")` if missing (already-expired-and-deleted logs 404 the same as never-existed ones — expected, not a bug).

**`errorLog.controller.ts`** — two thin `catchAsync` handlers (`getErrorLogs`, `getErrorLogById`), same `sendResponse` shape as every other controller. No create/update/delete controller — creation only ever happens internally from `globalErrorHandler`, never via a client-facing route.

**`errorLog.route.ts`**

```ts
const router = Router();

router.get("/", authCheck, adminCheck, errorLogController.getErrorLogs);
router.get("/:id", authCheck, adminCheck, errorLogController.getErrorLogById);

export const errorLogRouter = router;
```

Mounted in `router/index.ts`'s `routeArray`: `{ path: "/admin/error-logs", route: errorLogRouter }` (or `/error-logs`, per the namespace judgment call flagged above).

### 3. Wire logging into `globalErrorHandler.ts` (the only existing file this spec modifies)

After the existing status/message/errorSources resolution logic (unchanged) and **before** the `return res.status(status).json(...)` line, insert an awaited, self-contained try/catch:

```ts
try {
  await errorLogServices.createErrorLog({
    status,
    message,
    errorName: error?.name,
    errorSources,
    stack: error?.stack,
    method: req.method,
    path: req.originalUrl,
    userId: req.user?.userId ?? null,
    userEmail: req.user?.userEmail ?? null,
  });
} catch (logError) {
  // eslint-disable-next-line no-console
  console.error("Failed to persist error log:", logError);
}
```

`req.user` is only populated for requests that made it past `authCheck` before failing — for a pre-auth failure (bad login, missing token, a public route) it's simply `undefined`, so `userId`/`userEmail` fall back to `null`. This is expected, not a gap: those cases still get logged with everything _except_ who-was-logged-in, which is the best information actually available.

**Deliberately not filtered by status** — every error that reaches `globalErrorHandler` gets logged, including ordinary `400`s (bad input, a Zod rejection, a duplicate-key conflict), not just `5xx`s. This matches the user's stated goal directly ("if any user reports any issue, i dont know where, which error user get") — a user-reported problem is just as likely to be a confusing `400` as a `500`, and the admin list endpoint's `status` filter (e.g. `?status=500`) already gives a way to narrow to server errors only when that's what's wanted, without losing the rest.

### 4. Not covered by this spec (explicit scope boundaries)

- The `app.ts` trailing 404 handler (unmatched routes) — never reaches `globalErrorHandler`, so unmatched-path requests aren't logged. Could be added in a follow-up by having that handler construct a lightweight log entry directly, but that's a second call site outside the "one choke point" design this spec relies on — not built here.
- No admin-promotion endpoint (see Context above) — a manual DB write is the only way to create the first admin account.
- No manual delete/clear endpoint — retention is 100% TTL-driven, per the user's explicit ask.
- No log-volume rate limiting / dedup (e.g. collapsing 1,000 identical errors in a retry loop into one entry with a count) — every failure creates its own document. Flagged as a possible future concern if a single misbehaving client ever floods a route, not built here since nothing in the current app has that shape.
- No stack-trace truncation — full `error.stack` is stored as-is. A single document is nowhere near MongoDB's 16MB/document limit for any realistic stack trace, so this isn't a real constraint yet, just noted in case a future error type produces an unusually large stack.

## Implementation

1. ✅ `src/app/middleware/adminCheck.ts` — new middleware, `catchAsync`-wrapped, 403s when `req.user?.userRole !== UserRole.admin`.
2. ✅ New `src/app/modules/errorLog/errorLog.interface.ts` — `TErrorLog` type.
3. ✅ New `src/app/modules/errorLog/errorLog.model.ts` — schema + the two indexes (TTL on `createdAt`, compound `{status, createdAt}`).
4. ✅ New `src/app/modules/errorLog/errorLog.service.ts` — `createErrorLog`, `getErrorLogsFromDB` (Queryuilder-based, paginated), `getErrorLogByIdFromDB`.
5. ✅ New `src/app/modules/errorLog/errorLog.controller.ts` — `getErrorLogs`, `getErrorLogById`.
6. ✅ New `src/app/modules/errorLog/errorLog.route.ts` — both routes behind `authCheck` + `adminCheck`.
7. ✅ `src/app/router/index.ts` — mounted `{ path: "/admin/error-logs", route: errorLogRouter }` in `routeArray`.
8. ✅ `src/app/middleware/globalErrorHandler.ts` — added the awaited, try/caught `createErrorLog` call before the response is sent; imports `errorLogServices`.
9. ✅ `postman/bikelog-api.postman_collection.json` / `postman/dummy-data.md` — new "Error Logs" folder (List, Get by ID) plus a new "Error Logs" doc section, noting the admin-only nature and that a test account needs its `userRole` manually flipped to `"admin"` in the DB (plus a fresh login, per the JWT-staleness note above) before these requests will succeed.

## Dependencies

None new — reuses `mongoose` (already a dependency; `expireAfterSeconds` TTL indexes are a stock MongoDB/Mongoose feature, no plugin required), the existing `Queryuilder`, `catchAsync`, `AppError`, `sendResponse`, `authCheck`, and the existing `TerrorSource` type from `src/app/interface/error.ts`.

## Verify

- [x] A deliberately-triggered `400` (malformed `POST /bikes` body, hits the existing Zod-validated route) and two deliberately-triggered `404`s (`findOwnedBikeOrThrow`'s "Bike not found" on a nonexistent bike id, and a bad-login "User dont exist with this email") each produced exactly one new `ErrorLog` document with the correct `status`/`message`/`method`/`path` — confirmed live against a temporary local server instance (isolated port 5099, real dev DB).
- [x] An error triggered by an authenticated request (the two 404s above, both fired with a real user's JWT) captured the correct `userId`/`userEmail`; an error triggered by an unauthenticated request (the bad-login case, and a no-Authorization-header request against the new admin route) stored `userId: null`/`userEmail: null` instead of throwing — confirmed live, both cases present in the fetched list.
- [x] `GET /admin/error-logs` with a non-admin JWT returned `403` ("Admin access required"); with no token returned `401` ("Authorization header missing or malformed") — confirmed live, and both of those calls themselves correctly became new log entries in turn (visible in a later list fetch), proving the admin-gate rejections flow through the same `globalErrorHandler` path as every other error.
- [x] `GET /admin/error-logs` with a real admin JWT (a throwaway user, manually promoted via `userModel.updateOne({email}, {$set:{userRole:"admin"}})`, then **re-logged-in** to pick up a fresh token — confirmed the JWT payload's `userRole` was `"admin"` by decoding it) returned the paginated `{result, meta}` list, newest-first by default (`createdAt` descending, verified by inspecting the 5 returned entries' timestamps in order); `?status=400` correctly narrowed to exactly the 1 matching entry out of 5 total.
- [x] `GET /admin/error-logs/:id` returned the full document including a non-empty `stack` string; a nonexistent id (`64f000000000000000000000`) returned `404` "Error log not found" — confirmed live for both.
- [x] Code-reviewed (not live-tested, a deliberate call — see below): the `createErrorLog` call in `globalErrorHandler.ts` is `await`ed **before** the `res.status(status).json(...)` call, wrapped in its own `try/catch` that only `console.error`s on failure and never re-throws/calls `next()`. Not exercised by actually severing the DB connection mid-request, since doing so would have disrupted the shared real dev database the rest of this verification pass was actively using — the ordering and error-swallowing are structurally unambiguous from the code itself (a synchronous `try { await x() } catch {}` block placed textually before the `return res...` line), so a live fault-injection test wasn't judged necessary to add confidence here.
- [x] Confirmed the TTL index actually exists on the live collection (via a temporary script calling `errorLogModel.syncIndexes()` then `errorLogModel.collection.indexes()`): `{ key: { createdAt: 1 }, expireAfterSeconds: 2592000 }` present, plus the compound `{ status: 1, createdAt: -1 }` index. Actual 30-day expiry timing itself wasn't (and can't practically be) live-verified in this pass — verified the mechanism instead, per the spec's own note.
- [x] `yarn build` clean; `yarn lint` — 0 errors, the same pre-existing 14 warnings (all in files this spec didn't touch), no new warnings — confirmed the `console.error` in `globalErrorHandler.ts`'s new catch block didn't add one, since it carries its own `eslint-disable-next-line no-console`.

All throwaway fixtures (2 users, 5 error-log entries generated by the test traffic itself) were cleaned up afterward via temporary in-tree scripts reusing the app's own `config`/`mongoose.connect` (deleted immediately after running, same pattern as every prior spec's cleanup pass, since no user-delete API endpoint exists and this module intentionally has no delete endpoint of its own).
