# AI Integration (Spending Insight, Mileage Insight, Bike Chat)

## Goal

Add three AI-backed endpoints per bike — a cached spending insight, a cached mileage insight, and a grounded chat assistant — reusing the OpenRouter plumbing that already exists in this codebase unused. This is v2 scope (`../../../v2-proposed-features/06-ai-integration.md`), backend-only in this spec; `bikelog_client-web-` consumes it in its own spec (all three features, including the chat UI).

## Existing scaffolding (reuse, don't rebuild)

- `src/app/util/openRouterClient.ts` already exports `askOpenRouter(messages: TChatMessage[], options?: {jsonMode?, temperature?})`, a choke point that tries each model in `FREE_MODELS` in order and throws `AppError(503, "AI service is busy right now, please try again shortly")` only if every model fails. Use this directly — no new client, no new fallback logic.
- `openai` npm package and `config.openRouterApiKey` (reading `.env`'s already-set `openRouterApiKey`) are already wired. **No new dependency, no new env var.**
- `src/app/helper/openRouter.ts` is a redundant older duplicate — don't build on it, leave it alone.
- One small cleanup while touching this file: `openRouterClient.ts`'s `defaultHeaders` (`HTTP-Referer`/`X-Title`) are currently commented out, left over from the other project they were copied from. Uncomment and set `"X-Title": "Bike Log"`; leave `HTTP-Referer` pointing at whatever this project's actual deployed frontend URL turns out to be (placeholder acceptable if not yet finalized — these headers are for OpenRouter's own analytics/ranking, not functionally required).

## Design

**All three routes nest under `/bikes/:bikeId/ai`**, new module `src/app/modules/ai/` (`ai.route.ts`, `ai.controller.ts`, `ai.service.ts`, `ai.interface.ts`, `ai.validation.ts`), `Router({ mergeParams: true })`, `authCheck` on every route. Ownership (`findOwnedBikeOrThrow`) is checked **inside each service function**, matching the `spending` module's convention (not `mileageRecord`'s controller-level convention) — picked for consistency across all three new functions in this one module, rather than mixing both existing conventions within the same new file.

### 1. Spending insight — `GET /bikes/:bikeId/ai/spending-insight`

Cached the same way the other project caches its review summary: a count-based invalidation marker, not a TTL.

- Add to `TBike` (`bike.interface.ts`) and `bikeSchema` (`bike.model.ts`): `aiSpendingInsight?: string`, `aiSpendingInsightLogCount?: number` — both plain optional fields, no `required`, no `default`.
- `getSpendingInsightFromDB(bikeId, userId)`:
  1. `findOwnedBikeOrThrow` → `bike`.
  2. `currentLogCount = (fuelLog count) + (maintenanceLog count)` for this bike (`isDeleted: false`), via `.countDocuments()`.
  3. If `currentLogCount === 0`: return a fixed "no data yet" message, `generated: false` — no AI call for an empty bike.
  4. If `bike.aiSpendingInsight` exists and `bike.aiSpendingInsightLogCount === currentLogCount`: return the cached string, `cached: true` — no AI call.
  5. Otherwise: call `spendingServices.getSpendingSummaryFromDB(bikeId, userId, "lifetime")` for real totals/category breakdown, build a system prompt restricted to those numbers only ("only use the numbers given, never invent figures" — same rule as the other project's review-summary prompt), call `askOpenRouter`, save both `aiSpendingInsight` and `aiSpendingInsightLogCount` on the bike via `findByIdAndUpdate`, return the fresh string, `cached: false`.

### 2. Mileage insight — `GET /bikes/:bikeId/ai/mileage-insight`

Same shape as spending insight, keyed off fuel-log count instead (mileage is entirely fuel-log-derived):

- Add to `TBike`/`bikeSchema`: `aiMileageInsight?: string`, `aiMileageInsightFuelLogCount?: number`.
- `getMileageInsightFromDB(bikeId, userId)`: same cache-check shape, keyed on fuel-log count only. Data source: `mileageRecordServices.getLifetimeMileageFromDB(bikeId)` plus, if spec 15's `getMileageTrendFromDB` is already built, the trend data too (richer insight — "mileage dropped 15% since two months ago"); if spec 15 isn't built yet, lifetime totals alone are enough to ship this independently — **this endpoint should not hard-depend on spec 15 being done first.**

### 3. Bike chat — `POST /bikes/:bikeId/ai/chat`

Stateless per request (no conversation persistence) — the client resends the full message history each call, same as the other project's study assistant.

- Request body: `{ messages: {role: "user" | "assistant", content: string}[] }`. Validate via `ai.validation.ts` (zod): non-empty array, and **reject any message where `role === "system"`** — the system prompt is always server-constructed from real bike data; a client-supplied "system" message would be a prompt-injection vector letting a user override the grounding rules.
- `getBikeChatReply(bikeId, userId, messages)`:
  1. `findOwnedBikeOrThrow` → `bike`.
  2. Fetch bounded context — **most recent 20 fuel logs and 20 maintenance logs only** (`.sort({date: -1}).limit(20)`, maintenance logs populate `maintenanceType` for the name), plus `spendingServices.getSpendingSummaryFromDB(bikeId, userId, "lifetime")` for totals. The 20-record cap bounds prompt size/cost regardless of how much history a bike accumulates — this is a deliberate limit, not an oversight; a "when did I first..." question about very old history may legitimately fall outside what the assistant can see, and it should say so rather than guess (see next point).
  3. Build a system prompt listing the bike's name/brand/model, current odometer, the fetched recent logs, and lifetime spending, with the same explicit honesty rule as the other project's study assistant: *"Answer only using the data given above. If asked something this data doesn't cover, say so honestly instead of guessing."*
  4. `askOpenRouter([systemMessage, ...clientMessages])`, return `{ reply }`.

## Implementation

1. `src/app/util/openRouterClient.ts` — uncomment `defaultHeaders`, update to Bike Log's own values.
2. `src/app/modules/bike/bike.interface.ts` / `bike.model.ts` — add the four new optional cache fields.
3. New `src/app/modules/ai/ai.interface.ts` — `TSpendingInsightResponse`, `TMileageInsightResponse`, `TBikeChatResponse`, `TChatRequestMessage`.
4. New `src/app/modules/ai/ai.validation.ts` — zod schema for the chat request body (see Design §3).
5. New `src/app/modules/ai/ai.service.ts` — the three functions per Design above, exported as `aiServices`.
6. New `src/app/modules/ai/ai.controller.ts` — three `catchAsync` handlers, exported as `aiController`.
7. New `src/app/modules/ai/ai.route.ts` — `Router({ mergeParams: true })`, the three routes.
8. `src/app/router/index.ts` — add `{ path: "/bikes/:bikeId/ai", route: aiRouter }`.
9. Add all three new requests to `postman/bikelog-api.postman_collection.json`.

## Dependencies

None new. Mileage insight can optionally use spec 15's trend endpoint if that's already built, but doesn't require it.

## Verify-when-done

- [ ] `yarn build` / `yarn lint` clean.
- [ ] Spending/mileage insight: first call for a bike with data generates and caches; a second call with no new logs returns the cached value with no AI call (verify via a log/breakpoint, not just response shape); adding a new fuel log then calling again regenerates.
- [ ] A bike with zero logs returns the fixed "no data yet" message without ever calling `askOpenRouter`.
- [ ] Chat: a request containing a `role: "system"` message in the body is rejected (400), not silently accepted and forwarded to the model.
- [ ] Chat context is bounded to 20+20 logs regardless of how many the bike actually has — verify against a bike with 50+ logs that the request doesn't balloon.
- [ ] All three endpoints respect ownership — bike A's data never appears in bike B's insight/chat response for the same user, and a non-owned bike 403/404s before any AI call is made.
- [ ] If every model in `FREE_MODELS` fails (simulate by temporarily breaking the API key), all three endpoints surface the existing `AppError(503, ...)` cleanly, not a raw 500.
