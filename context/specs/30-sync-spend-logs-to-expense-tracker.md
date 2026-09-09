# 30: Sync fuel/maintenance/accessory spend to expenseTracker2

Status: ✅ Complete — implemented and verified 2026-09-09, see `context/progress-tracker.md`'s Recent Activity entry

## Goal

Today, logging a fuel fill-up, a maintenance service, or an accessory purchase here requires separately re-typing that spend into expenseTracker2 (the user's other app). This spec makes bikelog push each spend event to expenseTracker2 automatically, server-to-server, as a **pending review item** the user still has to explicitly accept there — bikelog never creates a real transaction on the other side, it only notifies.

## Cross-repo context

Depends on two specs in the expenseTracker2 repo, which must already be built and deployed before this one is implemented:
- `expenseTracker2/server/ai context/specs/07-bikelog-transaction-request-sync.md` — defines the `POST /api/transaction-requests/ingest` endpoint this spec calls, its payload shape, and its shared-secret auth.
- `expenseTracker2/client/ai context/specs/11-bikelog-transaction-requests-inbox.md` — the review UI on the other side; not needed to build or test this spec's server-side changes, but needed for a true end-to-end manual test (see Verify section).

Build order: expenseTracker2 server spec 07 → expenseTracker2 client spec 11 → **this spec, last**.

## Scope

**In scope:**
- A new outbound-call util, `notifyExpenseTracker`, fire-and-forget (never awaited, never blocks or fails bikelog's own response), implemented with **axios** (already installed as a backend dependency).
- Wiring it into fuel log creation, maintenance log creation, and the accessory **status update** transition to `purchased`. An accessory created directly with `status: "purchased"` does **not** trigger a sync — only the pending→purchased transition via update does.
- On failure, log via the existing `errorLog` module (spec 24) for visibility — no retry queue.

**Out of scope:**
- Any change to expenseTracker2 (covered by its own specs 07/11 above).
- A retry mechanism for failed sync calls — explicitly rejected; this codebase has no job queue and adding one is out of scope for this feature. A failed sync is visible in `errorLog` but not auto-retried.
- Syncing anything other than fuel logs, maintenance logs, and accessory purchases (e.g. no sync for bike documents, issues, etc.).

## Design

### 1. New outbound util — `src/app/util/expenseTrackerClient.ts`

Axios is already installed as a backend dependency (per user instruction — use it instead of global `fetch`). Must be **fire-and-forget**, unlike `cloudinary.ts`'s `deleteCloudinaryImage` which is awaited but internally swallows errors — this call must not add latency to bikelog's own response at all:

```ts
import axios from "axios";
import config from "../config";
import { errorLogServices } from "../modules/errorLog/errorLog.service";

export type TExpenseRequestPayload = {
  sourceType: "fuel" | "maintenance" | "accessory";
  sourceRecordId: string;
  userEmail: string;
  userId: string;
  title: string;
  description?: string;
  amount: number;
  occurredAt: Date;
};

// ! fire-and-forget — never awaited by callers, never throws, never blocks/fails
// ! bikelog's own API response. On failure, best-effort logged via errorLog for visibility.
export const notifyExpenseTracker = (payload: TExpenseRequestPayload): void => {
  const endpoint = `${config.expenseTrackerBaseUrl}/api/transaction-requests/ingest`;

  axios
    .post(
      endpoint,
      {
        sourceApp: "bikelog",
        sourceType: payload.sourceType,
        sourceRecordId: payload.sourceRecordId,
        userEmail: payload.userEmail,
        type: "expense",
        title: payload.title,
        description: payload.description,
        amount: payload.amount,
        occurredAt: payload.occurredAt.toISOString(),
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-integration-key": config.expenseTrackerIntegrationKey as string,
        },
      },
    )
    .catch(async (error) => {
      console.error("notifyExpenseTracker failed:", error);
      try {
        await errorLogServices.createErrorLog({
          status: 502,
          message: `Failed to sync ${payload.sourceType} spend to expenseTracker2: ${error?.message ?? error}`,
          errorName: "ExpenseTrackerSyncError",
          stack: error?.stack,
          method: "POST",
          path: "/api/transaction-requests/ingest",
          userId: payload.userId,
          userEmail: payload.userEmail,
        });
      } catch (logError) {
        // ! last resort: even error-logging must not throw out of a fire-and-forget call
        console.error("Failed to write errorLog for expenseTracker2 sync failure:", logError);
      }
    });
};
```

Reuses `errorLogServices.createErrorLog` from spec 24 (`src/app/modules/errorLog/errorLog.service.ts`) as-is — no changes needed there.

### 2. Config — `src/app/config/index.ts`

Add:
```ts
expenseTrackerBaseUrl: process.env.EXPENSE_TRACKER_BASE_URL,
expenseTrackerIntegrationKey: process.env.EXPENSE_TRACKER_INTEGRATION_KEY,
```
`.env` vars: `EXPENSE_TRACKER_BASE_URL` (e.g. `http://localhost:5000` locally), `EXPENSE_TRACKER_INTEGRATION_KEY` (must equal expenseTracker2's `INTEGRATION_API_KEY` from its spec 07).

### 3. Wire into the three flows — trigger point is each **controller**, right after its service call succeeds

**Fuel** — `fuelLog.controller.ts`'s `createFuelLog`, after `const { fuelLog, mileageRecordClosed } = await fuelLogServices.createFuelLogIntoDB(...)` and before `sendResponse`:
```ts
notifyExpenseTracker({
  sourceType: "fuel",
  sourceRecordId: String(fuelLog._id),
  userEmail: req.user.userEmail,
  userId: req.user.userId,
  title: `Fuel: ${fuelLog.fuelStation || "Fuel top-up"}`,
  description: fuelLog.notes,
  amount: fuelLog.totalCost,
  occurredAt: fuelLog.date,
});
```

**Maintenance** — `maintenanceLog.service.ts`'s `createMaintenanceLogIntoDB` (lines 15-51) already resolves `maintenanceType` locally before returning `log` at line 50. Widen the return value (public HTTP response body stays `data: log`, unchanged):
```ts
return { log, maintenanceTypeName: maintenanceType.name };
```
Controller destructures `{ log, maintenanceTypeName }` and fires:
```ts
notifyExpenseTracker({
  sourceType: "maintenance",
  sourceRecordId: String(log._id),
  userEmail: req.user.userEmail,
  userId: req.user.userId,
  title: `Maintenance: ${maintenanceTypeName || "Service"}`,
  description: log.notes,
  amount: log.cost,
  occurredAt: log.serviceDate,
});
```

**Accessory** — single trigger site, per explicit instruction: **only** when an accessory's status transitions to `purchased` via update — never at creation, even if an accessory is created directly with `status: "purchased"`.

**Update transition** (`updateBikeAccessoryInDB`, lines 122-178): the status lock is one-way (`purchased` can never be un-set, lines 141-150) and `purchaseDate` is stamped exactly once, on the transition (lines 167-172). Widen the return value with a transition flag, computed before `Object.assign`:
```ts
const justPurchased =
  accessory.status !== AccessoryStatus.purchased &&
  resultingStatus === AccessoryStatus.purchased;
// ...(existing purchaseDate-stamping logic, unchanged)...
Object.assign(accessory, updateData);
await accessory.save();
return { accessory, justPurchased };
```
Controller destructures `{ accessory, justPurchased }`, keeps `data: accessory` in the response (no contract change), and fires only `if (justPurchased)`:
```ts
if (justPurchased) {
  notifyExpenseTracker({
    sourceType: "accessory",
    sourceRecordId: String(accessory._id),
    userEmail: req.user.userEmail,
    userId: req.user.userId,
    title: `Accessory: ${accessory.name}`,
    amount: accessory.price!,
    occurredAt: accessory.purchaseDate!,
  });
}
```
This guarantees both (a) creating an accessory directly as `purchased` and (b) a later unrelated PATCH (e.g. editing `notes` on an already-purchased accessory, which the current code still permits) never fire the notification — only the actual pending→purchased transition does. `createBikeAccessoryIntoDB` (creation) is **not** touched by this spec.

**Idempotency note**: `sourceRecordId` is each record's Mongo `_id` (issued once, never reused), combined with expenseTracker2's `@@unique([sourceApp, sourceRecordId])` constraint (spec 07) — belt-and-suspenders in case `updateBikeAccessoryInDB` is ever called twice for the same transition.

## Implementation notes

Files touched/added:
- `package.json` — axios already installed, no change needed.
- `src/app/util/expenseTrackerClient.ts` (new)
- `src/app/config/index.ts` (edit — add two config vars)
- `.env` (edit — add `EXPENSE_TRACKER_BASE_URL`, `EXPENSE_TRACKER_INTEGRATION_KEY`)
- `src/app/modules/fuelLog/fuelLog.controller.ts` (edit)
- `src/app/modules/maintenanceLog/maintenanceLog.service.ts` (edit — widen return value)
- `src/app/modules/maintenanceLog/maintenanceLog.controller.ts` (edit)
- `src/app/modules/bikeAccessory/bikeAccessory.service.ts` (edit — widen `updateBikeAccessoryInDB` return value only; `createBikeAccessoryIntoDB` untouched)
- `src/app/modules/bikeAccessory/bikeAccessory.controller.ts` (edit — update-path controller only)

## Verify when done

Requires expenseTracker2 (server spec 07, ideally client spec 11 too) already running locally, per Cross-repo context above.

- [ ] Create a fuel log; confirm bikelog's own response is unchanged in shape/latency; confirm a `TransactionRequest` appears in expenseTracker2 with the right title (`"Fuel: <station>"`) and amount (`totalCost`).
- [ ] Create a maintenance log; confirm the synced title uses the maintenance type name and amount matches `cost`.
- [ ] Create an accessory directly with `status: "purchased"` and a `price`; confirm it does **not** trigger (creation is never a trigger point).
- [ ] Create an accessory `pending` (no price required); confirm it does **not** trigger.
- [ ] PATCH that pending accessory to `purchased` with a `price`; confirm it now triggers exactly once.
- [ ] PATCH an unrelated field (e.g. `notes`) on the now-purchased accessory; confirm **no** second request is created.
- [ ] Stop the expenseTracker2 server, then create another fuel log; confirm bikelog's HTTP response to its own client is unaffected (same status/shape/latency), and that a new `ExpenseTrackerSyncError` entry appears in bikelog's `errorLog` collection with the correct `userEmail`/`userId`.
- [ ] Restart expenseTracker2; confirm the failed fuel log from the previous step is **not** automatically retried (accepted trade-off, no retry queue).
