# 58 — AI context: the assistant can see engine oil changes

**Status**: ✅ Code complete — implemented 2026-10-19. `yarn build` clean, `yarn lint` no new findings.
**Not exercised over HTTP** — K-V1…K-V6 below all need the deployed server and a bike with oil changes.
**Scope**: `bikelog_server/` only, one file — `src/app/modules/ai/ai.service.ts` — plus the Postman
descriptions for the three AI requests. No schema change, no migration, no new route, no new response field.
**Purely additive**: the chat reply is still `{ reply }` and both insight shapes are untouched, so **cascade
step 3 is not triggered** and neither client needs a change.
**Lifted from** `bikelog_app/ai context/specs/57-engine-oil-log.md` §K, which specified this fix in full and
reserved it as server work. That section says to file it as spec `55`; 55 was taken by the profile-email spec
before this was built, so it is **58** — as `context/progress-tracker.md` already recorded.

---

## Request

> 4. **The AI assistant has gone blind to oil changes — fix it?** — **"fix this"**

Settled by the developer on 2026-10-18, while app spec 57 was being written. The gap was found there (its H-O),
not here: `components/main/AiAssistant/AiAssistant.tsx:17` offers _"When is my next oil change due?"_ as its
**first** suggested chip.

---

## Problem

`ai.service.ts` builds the model's entire view of a bike from `fuelLog` and `maintenanceLog`. Spec 54 gave
engine oil its own table and its `--finalize` soft-deleted the 8 source maintenance logs on 2026-10-18, so:

1. **The chat cannot see a single oil change.** Both of its log queries filter `isDeleted: false`, and
   `engine_oil_logs` is never read. The starter chip's question gets a confident _"no oil change on record"_ —
   the bad failure mode: not an error, a wrong answer stated plainly.
2. **The cached spending insight can no longer be invalidated by oil.** `getSpendingInsightFromDB` gates its
   cache on `fuelLogCount + maintenanceLogCount`, but spec 54 §F made `computeSpendingForRange` sum
   `engineOilLog` and emit an `Engine Oil` category. So an oil change moves the numbers the insight is
   generated from without moving the count that decides whether to regenerate.
3. **The no-data guard reads false.** A bike whose only spending is oil changes returned
   `NO_DATA_SPENDING_MESSAGE` while `GET /spending-summary` reported a real total.

**Neither server spec 54 nor web spec 33 noticed any of this.**

---

## Design

Three edits, exactly as app spec 57 §K specified them.

| # | Edit | Why |
| --- | --- | --- |
| K1 | A third `prisma.engineOilLog.count({ where: { bikeId, isDeleted: false } })` in `getSpendingInsightFromDB`'s `Promise.all`, added into `currentLogCount` | Closes problems 2 and 3 together. The count is the cache key *and* the no-data guard, so one addition fixes both |
| K2 | A fourth `findMany` in `getBikeChatReply`'s `Promise.all`, projected down to the fields a model can use, the way the other two are | Closes problem 1 |
| K3 | A fourth data block in the system message, between the maintenance logs and lifetime spending, in the existing phrasing | The prompt already states `Current odometer`, so `nextDueOdometer` is all the model needs to answer the chip |

### Decisions

| # | Decision | Why |
| --- | --- | --- |
| D1 | **Raw numbers to the model, not a computed due date** — `getEngineOilStatusFromDB` is deliberately *not* called | §K HK2. It would be a second source of truth for a figure the oil screen also renders (app spec 53 H-E), and the maintenance block directly above hands over `nextDueOdometer`/`nextDueDate` raw and lets the model reason. Consistency with it beats richer context |
| D2 | `orderBy: [{ changeDate: "desc" }, { createdAt: "desc" }]` | The `changeDate` tie-break the rest of the oil module already uses, so two changes on one calendar day reach the prompt in the order the app's list shows them |
| D3 | `Number(log.cost)` in the projection | HK1 — non-negotiable, see Hazards |
| D4 | The oil block is emitted **even when empty** (`[]`) | K-V6. An omitted block would let the model fall back on its own guesses about a bike it was told nothing about; an explicit empty array is the honest signal, and the prompt's closing instruction already tells it to say so |
| D5 | `NO_DATA_SPENDING_MESSAGE` now names an oil change alongside a fuel-up and a maintenance entry | **Not in §K.** With K1 the guard only fires when all *three* counts are zero, so the old two-item sentence named an incomplete set of ways out of the state it was describing. One string, no shape change |
| D6 | `getMileageInsightFromDB` left alone | HK4. It gates on `aiMileageInsightFuelLogCount` alone, which is correct — an oil change does not move km/l |

### Contract

Unchanged, in all three endpoints. This spec changes only what the model is *told*.

---

## Hazards

| # | Hazard | Handling |
| --- | --- | --- |
| HK1 | `JSON.stringify` on a raw Prisma `Decimal` emits a **string** (`"cost":"1250.00"`), silently changing what the model sees and does arithmetic on | `Number(log.cost)` in the projection. The comment at the fuel-log projection exists because this was got wrong before; K-V5 is the check |
| HK2 | Injecting `projectedDueDate` from `getEngineOilStatusFromDB` is tempting and wrong | D1. Not done |
| HK3 | Prompt size — `CHAT_LOG_LIMIT` (8) is now shared by **three** lists, so this adds up to 8 rows of ~10 fields | Fine at today's budget. If the prompt ever needs trimming, trim **here** rather than lowering the constant for all three |
| HK4 | K1 copy-pasted into the mileage insight would make an oil change invalidate a km/l insight | D6. Not done |
| HK5 | The cached insight self-heals **twice**, and the intermediate one is wrong | `--finalize` already moved `maintenanceLogCount` by −8, so the next call regenerates from oil-blind data and caches a wrong insight. K1 moves the count again (+8 from the new term), so the first call after this deploys regenerates once more, correctly. Expect two regenerations; don't read the intermediate one as a bug |
| HK6 | **A refinement to HK5 that §K did not spot: if no one requested the insight between `--finalize` and this deploy, the two moves cancel exactly and a pre-import insight is served as still-valid.** `F + M` before the import; `F + (M−8) + 8` after K1 — the same number, so a cached insight generated before spec 54 matches the new count and is never regenerated | Low-harm: spec 54 V11 verified the lifetime **total** is identical to the paisa, so such an insight's figures are right; only its category naming is pre-split (it may say "Maintenance" where the hub now says "Engine Oil"). Not worth code — a conditional "regenerate once" flag would outlive its purpose. Operator one-liner if the wording matters: `UPDATE bikes SET "aiSpendingInsight" = NULL;` — the next request regenerates every bike's at a cost of one model call each. **Not run; the developer's call** |
| HK7 | An oil log whose `oilTypeId` is `NULL` (one of spec 54 §H's imported rows — H7 allows it) | `log.oilType?.name ?? null` — an explicit `null`, never `undefined`, which `JSON.stringify` would drop from the object entirely and make the field's absence ambiguous |

---

## Implementation steps

1. `ai.service.ts` — K1: the third count in `getSpendingInsightFromDB`, into `currentLogCount`. ✅
2. `ai.service.ts` — D5: `NO_DATA_SPENDING_MESSAGE` names an oil change. ✅
3. `ai.service.ts` — K2: the fourth `findMany` plus the `recentEngineOilLogs` projection. ✅
4. `ai.service.ts` — K3: the fourth data block in the system message. ✅
5. Postman — note the oil block in Bike Chat's description and the three-table count in Spending Insight's. ✅

---

## Test plan

Static floor done: `yarn build` clean, `yarn lint` no new findings. Everything below needs the **deployed**
server and a bike with oil changes — and per app spec 57 §K this must ship in the same push as specs 55–57, so
the assistant is never deployed knowing about `engine_oil_logs` that the API does not yet expose.

| # | Check | Expect | State |
| --- | --- | --- | --- |
| K-V1 | `POST /bikes/:id/ai/chat` — _"When is my next oil change due?"_ | an answer naming the real last change, its odometer and `nextDueOdometer`; **not** "no oil change on record" | ⬜ Postman |
| K-V2 | _"How much have I spent on engine oil?"_ | a figure matching the `Engine Oil` category in `GET /spending-details` | ⬜ Postman |
| K-V3 | `GET /bikes/:id/ai/spending-insight` twice | first call `cached: false`, second `cached: true`; the insight mentions oil | ⬜ Postman |
| K-V4 | Add an oil change, re-request the insight | `cached: false` again — K1's count moved | ⬜ Postman |
| K-V5 | The raw prompt, logged once in dev | `cost` is a **number**, not a quoted string (HK1) | ⬜ dev |
| K-V6 | A bike with no oil change at all | the oil block is present and **empty**, no `undefined`, and the assistant says it has no oil history rather than inventing one | ⬜ Postman |
| K-V7 | A bike whose **only** spending is oil changes | `spending-insight` generates instead of answering `NO_DATA_SPENDING_MESSAGE` (problem 3) | ⬜ Postman |
| K-V8 | An imported oil row with `oilTypeId: NULL` reaches the prompt | `"oilType": null` present, not absent (HK7) | ⬜ dev |
| K-V9 | `yarn build` + `yarn lint` | clean / no new findings | ✅ |

The companion check in the app repo is app spec 57 **V26**, which is the same assertion from the UI side.
