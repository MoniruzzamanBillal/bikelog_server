# Postgres Migration — Phase 7: `spending`, `ai`, `notification`

## Status

Proposed — not yet implemented. Seventh and **last rewrite phase** from `mongodb-to-postgres-migration-plan.md` (repo root) — after this lands, every service function in the codebase talks to Prisma/Postgres and Phase 8 (the one real cutover + data migration) becomes possible. This phase is explicitly where every "known, accepted incoherence" flagged in specs 31–35 gets resolved — cross-reference table in §A.

## Goal

Rewrite the three modules with no `.model.ts`/schema of their own but that read and aggregate across every other model: `spending` (cost aggregation), `ai` (cached insights + chat, reads `spending`/`mileageRecord`/`bikeManual`), `notification` (weekly push digest, reads `user`/`bike`/`mileageRecord`/`spending`). All three are pure consumers of other modules' Prisma clients by this point — by construction, this phase has zero remaining Mongoose-model rewrites of its own, just call-site updates to already-migrated modules' new (Prisma) shapes.

## Design decisions

### A. This phase is where every deferred cross-module incoherence resolves — full list

Every prior spec explicitly deferred a cross-module Mongo/Postgres split to "Phase 7." Complete list, so nothing is missed:

| Spec | Deferred issue |
|---|---|
| 31 §"Known, accepted incoherence" | `notification.service.ts` reads `userModel` directly |
| 32 §D | `ai.service.ts` writes `bikeModel.findByIdAndUpdate` directly; `notification.service.ts` reads `bikeModel` directly |
| 33 §G | `spending.service.ts` reads `fuelLogModel` directly; `ai.service.ts` reads `fuelLogModel` directly (count) |
| 34 out-of-scope note | `spending.service.ts` reads `maintenanceLogModel` directly (with `.populate`) |
| 35 §D4 | `spending.service.ts` reads `bikeAccessoryModel` directly |

After this phase, **no module anywhere in the codebase imports a `.model.ts` file from outside its own module** — the precondition for Phase 8's atomic cutover (top-level plan: "All Mongoose service code must be fully rewritten (Phases 1–7) before this step").

### B. `spending.service.ts` — three direct Mongo reads become Prisma relational queries; the Decimal-sum trap is exactly what top-level plan decision #6 warned about, now concrete

`computeSpendingForRange` is the single function every other `spending` export funnels through — get this one right and the other three (`getSpendingSummaryFromDB`, `getSpendingDetailsFromDB`, `getSpendingTrendFromDB`) follow for free.

```ts
const [fuelLogs, maintenanceLogs, accessories] = await Promise.all([
  prisma.fuelLog.findMany({
    where: { bikeId, isDeleted: false, ...(startDate && endDate ? { date: { gte: startDate, lte: endDate } } : {}) },
  }),
  prisma.maintenanceLog.findMany({
    where: { bikeId, isDeleted: false, ...(startDate && endDate ? { serviceDate: { gte: startDate, lte: endDate } } : {}) },
    include: { maintenanceType: { select: { name: true } } }, // replaces .populate("maintenanceType", "name")
  }),
  prisma.bikeAccessory.findMany({
    where: {
      bikeId, isDeleted: false, status: AccessoryStatus.purchased,
      ...(startDate && endDate ? { purchaseDate: { gte: startDate, lte: endDate } } : {}),
    },
  }),
]);
```

`maintenanceLogs[i].maintenanceType` is now a real joined object (`{ name: string }`, via Prisma `include`+`select`) — the existing `as unknown as { _id: string; name: string } | null` cast in `maintenanceByCategory`'s reduce and the `maintenanceRecords` map becomes unnecessary (Prisma's generated type already reflects the include), but the *behavior* (group by `.name`, fall back to `"Unknown"` if somehow absent) stays identical — `maintenanceType` is a required FK here so `null` shouldn't actually occur, but keep the `?? "Unknown"` fallback anyway, matching current defensive behavior rather than tightening it as a drive-by change.

**The Decimal-sum trap, made concrete** — every one of these `reduce`/summation call sites operates on a field that's `Decimal(12,2)` post-migration and **must** convert first:
- `fuelLogs.reduce((sum, log) => sum + log.totalCost, 0)` → `sum + Number(log.totalCost)`.
- `maintenanceByCategory`'s `acc[category] = (acc[category] ?? 0) + log.cost` → `+ Number(log.cost)`.
- `accessories.reduce((sum, a) => sum + (a.price ?? 0), 0)` → `+ (a.price ? Number(a.price) : 0)`.
- `maintenanceLogs.reduce((sum, log) => sum + log.cost, 0)` (the `maintenanceTotal` line) → same `Number(...)` wrap.
- The three `TSpendingRecord.amount` mappings (`fuelRecords`/`maintenanceRecords`/`accessoryRecords`) — `amount: log.totalCost` / `log.cost` / `a.price as number` all need `Number(...)` too, since `TSpendingRecord.amount` is typed `number` and these feed directly into `ai.service.ts`'s prompt-building `JSON.stringify(summary)` (a Decimal serialized into a prompt string would either stringify oddly or, worse, look plausible-but-wrong to the AI) and into `notification.service.ts`'s `.toFixed(0)` call (`spending.totalSpending.toFixed(0)` — **this one throws a runtime `TypeError` if `totalSpending` isn't a real JS number**, not just a formatting nit — get this specific one right).
- Also the fuel-log description string interpolation (`@ ৳${log.pricePerLiter}/L`) — wrap in `Number(...)` too, for consistency, even though template-string coercion happens to produce a readable result either way.

`resolveSpendingDateRange` is pure date-math, untouched.

### C. `ai.service.ts` — resolves its own Phase 2 flag, plus straightforward count/read conversions

```ts
// getSpendingInsightFromDB / getMileageInsightFromDB
const [fuelLogCount, maintenanceLogCount] = await Promise.all([
  prisma.fuelLog.count({ where: { bikeId, isDeleted: false } }),
  prisma.maintenanceLog.count({ where: { bikeId, isDeleted: false } }),
]);
// ...
await prisma.bike.update({
  where: { id: bikeId },
  data: { aiSpendingInsight: insight, aiSpendingInsightLogCount: currentLogCount },
});
```
This is the exact write spec 32 §D flagged as silently diverging from Postgres since Phase 2 — after this phase, it's the same `prisma.bike` instance `findOwnedBikeOrThrow` already reads from, so caching starts actually working again (no code changes needed in `bike.utils.ts` itself, this was always a call-site problem in `ai.service.ts`).

`getBikeChatReply`'s `fuelLogModel.find(...).sort().limit().lean()` / `maintenanceLogModel.find(...).sort().limit().populate("maintenanceType","name").lean()` become `prisma.fuelLog.findMany({ where, orderBy: { date: "desc" }, take: CHAT_LOG_LIMIT })` / the equivalent with `include`, same pattern as §B. The `bike.manual`/`bike.nickname`/`bike.brand`/`bike.model`/`bike.currentOdometer` reads are already plain Prisma-row field access since Phase 2 — no change. `bikeManualServices.getRelevantManualChunksForChat(...)` call is unchanged (already Prisma-backed since Phase 5, same function signature) — this file doesn't need to know or care that it changed underneath.

Note: `JSON.stringify(recentFuelLogs)`/`JSON.stringify(recentMaintenanceLogs)` feed straight into the AI system prompt — if these still carry un-converted `Decimal` fields, `JSON.stringify` on a Prisma `Decimal` instance produces a **string**, not a bare number, in the resulting JSON text (e.g. `"totalCost":"450.00"` vs `450.00`) — not a crash, but silently changes what the model sees. Run these through the same `toApiShape`/`Number(...)` conversion the list/get endpoints already use (Phase 3/4's `toApiShape` helpers) before stringifying, rather than serializing raw Prisma rows.

### D. `notification.service.ts` — field renames + the `.toFixed(0)` crash risk from §B

```ts
const users = await prisma.user.findMany({ where: { expoPushToken: { not: null }, isDeleted: false } });
// ...
const bikes = await prisma.bike.findMany({ where: { ownerId: user.id, isDeleted: false } });
for (const bike of bikes) {
  const bikeId = bike.id; // was bike._id.toString()
  // ...
}
```
`console.error(\`... user ${user._id}\`)` → `user.id`. Everything else (the Expo push-notification batching/sending logic, `getCurrentWeekRange` from `notification.utils.ts`) is untouched — no DB access in that part at all.

This module is the reason §B's `.toFixed(0)` note matters concretely: `spending.totalSpending.toFixed(0)` is called on the result of `spendingServices.computeSpendingForRange` — if that function's own `Number(...)` conversions (§B) are done correctly, `totalSpending` is already a plain number by the time it reaches here and `.toFixed(0)` just works; if §B is implemented incompletely, this specific line is where the omission surfaces as a live crash (500) in the weekly cron job, not a subtle display bug — worth its own explicit check in the verify list below, not just folded into "the spending endpoints work."

### E. Suggested internal ordering within this phase

`ai`/`notification` both call into `spendingServices` — rewrite `spending.service.ts` first, verify its endpoints directly, *then* rewrite `ai.service.ts`/`notification.service.ts` on top of the now-correct Prisma-backed spending functions, rather than rewriting all three in parallel and debugging compounded Decimal-conversion bugs across module boundaries at once.

## Implementation

1. `spending.service.ts` — rewrite `computeSpendingForRange` (the shared core) + verify the three thin wrappers around it need no further changes beyond what falls out automatically.
2. `ai.service.ts` — rewrite per §C.
3. `notification.service.ts` — rewrite per §D.
4. Delete now-orphaned `.model.ts` files that were kept alive purely for these three modules' direct imports, **after re-grepping each one** to confirm no other importer remains: `user.model.ts` (spec 31), `bike.model.ts` (spec 32), `fuelLog.model.ts`/`maintenanceLog.model.ts` (specs 33/34), `bikeAccessory.model.ts` (spec 35) — cross-check spec 35's own "do not delete yet" list too, since some of those may have already been resolved by Phase 5 itself if nothing else referenced them.
5. `spending.interface.ts` — likely unchanged (`TSpendingRecord` etc. are already plain, DB-agnostic types); confirm.

## Files touched

- `src/app/modules/spending/spending.service.ts` (rewrite)
- `src/app/modules/ai/ai.service.ts` (rewrite)
- `src/app/modules/notification/notification.service.ts` (rewrite)
- Deletions (pending re-grep, per §Implementation.4): `user.model.ts`, `bike.model.ts`, `fuelLog.model.ts`, `maintenanceLog.model.ts`, `bikeAccessory.model.ts`, and any other `.model.ts` still lingering from specs 31–35's "kept, pending" notes.

## Out of scope for this phase

- The actual Phase 8 cutover / real data migration script — this phase only finishes the code rewrite; no production data moves here. Postgres is still just the empty (or locally-seeded-for-testing) schema every prior phase tested against.
- `errorLog`'s axis-1/axis-2 decisions (spec 36 §B) — independent of this phase, may already be resolved by the time this phase starts or may still be open; doesn't block this phase either way.

## Dependencies

Phases 1–5 (specs 31–35) all landed — this phase's entire job is closing out cross-references into modules those phases rewrote. Phase 6 (spec 36) not required as a hard dependency (no code in this phase touches `errorLog`), but sequencing it before this phase (as the top-level plan does) keeps the "lowest priority, do it whenever" module from blocking the actually-load-bearing final rewrite phase.

## Verify-when-done

- [ ] `yarn build` / `yarn lint` clean.
- [ ] `spending` endpoints (`summary`, `details`, `trend`) against a Postgres-backed bike with real fuel/maintenance/accessory history — `totalSpending`/`categoryBreakdown`/`records[].amount` are all plain JSON numbers, not `"450.00"`-style strings; category breakdown groups maintenance logs by type name correctly (regression-checks the `.populate`→`include` swap).
- [ ] `ai` spending/mileage insight endpoints regenerate once, then correctly **cache** on the second call with no new logs added (confirms §C's fix — caching was silently broken since Phase 2, this is the check that proves it's fixed again). Bike chat (`POST /bikes/:bikeId/ai/chat`) still answers using real fuel/maintenance/spending/manual context, with no `"450.00"`-shaped numbers leaking into the model's visible context (spot-check via a question that surfaces a cost figure).
- [ ] Manually trigger `notificationServices.sendWeeklySummaries` (or the cron endpoint) against a Postgres-backed user+bike with fuel logs in the current week — confirm it does **not** throw on `spending.totalSpending.toFixed(0)` (§D's specific crash-risk check) and that the push notification body has correct, plain numbers.
- [ ] Full grep sweep: `grep -rn "\.model\'" src --include="*.ts"` (or equivalent) finds no remaining cross-module `.model.ts` imports anywhere outside a module's own folder — this is the actual precondition check for Phase 8, not just a nice-to-have.
- [ ] Record, per module, which `.model.ts` files were actually deleted in this phase vs. still needed for some reason not anticipated here — feeds directly into Phase 8's spec.
