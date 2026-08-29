# 25: Bike Accessory Purchase Lock + Spending Summary Integration

Status: ✅ Complete

## Goal

Two direct user requests, arising from a real workaround: the user was logging accessory purchases (e.g. a crash guard bought 2026-08-20 for ৳1290) as `MaintenanceLog` entries under category "Others", because `bikeAccessory.price` was never wired into `spending.service.ts`'s totals — an accessory purchase simply didn't count toward their spending numbers any other way.

1. An accessory's `price` counts toward Spending Summary totals **only when `status === "purchased"`** (a `pending`/`cancelled` wishlist entry never counts).
2. Once an accessory's `status` becomes `"purchased"`, it's a **permanent, one-way lock** — no further status change is allowed (not even back to `pending`/`cancelled`), though every other field (`name`, `urgency`, `price`, `productImage`) stays freely editable.
3. `price` is **required** at the moment an accessory becomes `"purchased"` (create-as-purchased, or update into purchased) — rejected with a clear `400` if missing.
4. The purchase date is **fully server-computed**, not client-supplied: stamped to `new Date()` the instant `status` actually transitions into `"purchased"`, exactly once per accessory (the permanent lock guarantees it only ever fires once).

This resolves the limitation `context/specs/23-spending-details-export-endpoint.md` explicitly flagged: *"`BikeAccessory` has a `price` field but no date field and is already excluded from `/spending-summary`'s aggregation today... a known limitation, not something to silently work around."*

## Context

- Confirmed via `git log` (all branches): `bikeAccessory`/`BikeAccessory` had never been referenced anywhere in `spending.service.ts`'s history before this spec — the exclusion was total, not partial.
- This app's own house invariant (`context/architecture.md` #8): aggregation buckets by a user-editable **event-date** field (`FuelLog.date`, `MaintenanceLog.serviceDate`), never by `createdAt`/`updatedAt`, because `updatedAt` shifts on any later edit. `bikeAccessory` had no such field. A new `purchaseDate` fills that role — but per the user's explicit answer, it's *not* user-editable like `FuelLog.date` is; it's stamped automatically by the server the moment the purchase actually happens (`status → "purchased"`), and — since status can never change again once purchased — is guaranteed to be set exactly once and never touched again by a later field edit.
- `bikeAccessory` has no separate status-only route (unlike `bikeIssue`'s `PATCH /:id/status`) — confirmed in `bikeAccessory.route.ts`: one `PATCH /:id` handles every field, including `status`. So both the lock rule and the price-required rule had to live inside the general `updateBikeAccessoryInDB`, not a new endpoint.
- `computeSpendingForRange` (`spending.service.ts`) is the one shared function behind `getSpendingSummaryFromDB`, `getSpendingDetailsFromDB` (spec 23), `getSpendingTrendFromDB` (spec 15/22), and `notification.service.ts`'s weekly-digest `sendWeeklySummaries` (spec 21) — extending it once means all four surfaces pick up accessory spending automatically, with no other file needing a change.
- This spec is backend-only. The corresponding `bikelog_client-web-`/`bikelog_app` UI changes (status-field lock, client-side price-required validation) are tracked in those projects' own spec workflows, not here. Per explicit user instruction, merging any of these three repos' `dev/monir` branches into `master` and deploying is the user's own responsibility — **not** part of this spec.

## Design

### 1. `bikeAccessory.interface.ts` / `bikeAccessory.model.ts`
Added `purchaseDate?: Date` — output-only, no `required`/`default` at the schema level (mirrors `bikeIssue.model.ts`'s `dateReported`: schema-optional, service-set). Never accepted from the client — absent from both Zod schemas, same treatment as `MaintenanceLog.nextDueOdometer`.

### 2. `bikeAccessory.service.ts`

**`createBikeAccessoryIntoDB`**: if `payload.status === "purchased"` and no `price` was supplied, throws `400`. If created directly as `"purchased"`, stamps `purchaseDate: new Date()`.

**`updateBikeAccessoryInDB`** — three rules layered onto the existing fetch → assign → save flow, in this order:
1. **Lock check**: if the existing document's `status` is already `"purchased"` and the payload tries to set a *different* `status`, throw `400` ("This accessory is already marked as purchased and its status cannot be changed"). Mirrors `bikeIssue.service.ts`'s `updateBikeIssueStatus` idiom (fetch → compare → throw) exactly.
2. **Price-required check**: compute `resultingStatus`/`resultingPrice` (payload value if present, else the existing document's), and if the *resulting* state is `"purchased"` with no price, throw `400`. This also covers editing other fields on an already-purchased accessory that (hypothetically) has no price — can't actually happen going forward since price is enforced at the transition moment, but the check is harmless and cheap on every update.
3. **Stamp on transition**: only when the document's *previous* status wasn't `"purchased"` and the *resulting* status is — i.e. exactly at the pending/cancelled → purchased transition — set `purchaseDate = new Date()`. Combined with the permanent lock, this guarantees the stamp happens exactly once per accessory, ever.

### 3. `spending.service.ts` — `computeSpendingForRange`
Added a third parallel query alongside the existing `fuelLogsPromise`/`maintenanceLogsPromise`:
```ts
bikeAccessoryModel.find({
  bike: bikeId,
  isDeleted: false,
  status: AccessoryStatus.purchased,
  ...(startDate && endDate ? { purchaseDate: { $gte: startDate, $lte: endDate } } : {}),
}).lean();
```
`accessoryTotal` is summed and added to `totalSpending`; a `"Accessories"` row is appended to `categoryBreakdown` only when `accessoryTotal > 0` (matches the existing pattern where a maintenance category only appears when it has entries — no zero-value clutter). `accessoryRecords` (`source: "accessory"`, `description: a.name`, `date: a.purchaseDate`) are merged into the chronologically-sorted `records` array alongside fuel/maintenance records.

`TSpendingRecordSource` widened from `"fuel" | "maintenance"` to `"fuel" | "maintenance" | "accessory"` in `spending.interface.ts`.

**Flagged edge case, not solved here**: any accessory already marked `"purchased"` in a dev/test database *before* this spec shipped has no `purchaseDate` — it still counts correctly under `period=lifetime` (no date filter applied there) but silently won't appear in a `month`/`year` bucket. Low-stakes (no production data exists yet, per this spec's own Context) — not solving with a backfill script unless asked.

## Implementation

1. ✅ `bikeAccessory.interface.ts` — added `purchaseDate?: Date`.
2. ✅ `bikeAccessory.model.ts` — added `purchaseDate: { type: Date }`.
3. ✅ `bikeAccessory.validation.ts` — **no change** (deliberately never client-accepted).
4. ✅ `bikeAccessory.service.ts` — `createBikeAccessoryIntoDB` (price-required + stamp on create-as-purchased) and `updateBikeAccessoryInDB` (lock + price-required + stamp-on-transition) updated as designed above.
5. ✅ `spending.service.ts` — `computeSpendingForRange` extended with the accessory query, `accessoryTotal`, `"Accessories"` category row, `accessoryRecords`.
6. ✅ `spending.interface.ts` — `TSpendingRecordSource` widened to include `"accessory"`.
7. ✅ `postman/bikelog-api.postman_collection.json` — added `Create Bike Accessory` (POST, auto-captures `bikeAccessoryId`), `List Bike Accessories` (GET), and `Attempt Status Change After Purchased (expect 400)` to the "Bike Accessories" folder (previously had neither Create nor List — a pre-existing gap this spec closes); updated the existing image-upload request's stale "not auto-captured" note.
8. ✅ `postman/dummy-data.md` — added a full "Bike Accessories" section (purchase lock, price-required rule, server-computed `purchaseDate`, the spec-13 grouped-list-order quirk); updated the Spending Summary section to note the new `Accessories` category bucket; corrected the two stale `bikeAccessoryId`-not-auto-captured notes.
9. ✅ `context/architecture.md` invariant #8 — added `BikeAccessory.purchaseDate` as a third example alongside `FuelLog.date`/`MaintenanceLog.serviceDate`.

## Dependencies

None new — reuses `bikeAccessoryModel`/`AccessoryStatus` (imported into `spending.service.ts`), the existing `AppError`/`httpStatus` pattern, and the already-shared `computeSpendingForRange` choke point.

## Verify

- [x] Creating an accessory as `"pending"` with no `price` succeeds (unchanged behavior) — confirmed live ("Phone Mount", `201`).
- [x] Creating (or updating into) `"purchased"` with no `price` → `400` "Price is required when marking an accessory as purchased" — confirmed live for both create ("Tail Light") and update (transitioning "Phone Mount" without a price).
- [x] Creating directly as `"purchased"` with a `price` succeeds; `purchaseDate` is stamped to the current date — confirmed live ("Crash Guard (Bumper)", `price: 1290`, `purchaseDate` present and equal to the creation instant).
- [x] Updating a `pending`/`cancelled` accessory to `"purchased"` (with a price supplied in the same request) succeeds and stamps `purchaseDate` — confirmed live ("Phone Mount" → purchased with `price: 450`, `purchaseDate` stamped to that update's timestamp).
- [x] Attempting to change a `"purchased"` accessory's `status` to anything else → `400` "This accessory is already marked as purchased and its status cannot be changed" — confirmed live against the Crash Guard.
- [x] Editing a `"purchased"` accessory's `name`/`price`/`urgency` (status omitted from the payload, or resent as the same `"purchased"` value) succeeds normally, and `purchaseDate` is left untouched — confirmed live twice (a `price` edit, then a same-value `status` + `urgency` edit); `purchaseDate` stayed byte-identical (`2026-08-29T10:22:51.668Z`) across both.
- [x] `GET /spending-summary?period=month&targetMonth=<current month>` includes purchased accessories' prices in `totalSpending` (confirmed `1350 + 450 = 1800`) and shows an `"Accessories"` row in `categoryBreakdown`; a `pending` accessory with a `price` set ("Tank Pad", `price: 500`) does **not** move the total — confirmed live, total stayed `1800` after creating it. Also confirmed for `period=lifetime`.
- [x] `GET /spending-summary/details` includes each purchased accessory as its own `source: "accessory"` record with the correct `date`/`description`/`amount` — confirmed live (both Crash Guard and Phone Mount present, correct fields).
- [x] `yarn build` clean; `yarn lint` — same pre-existing 14 warnings / 0 errors baseline, none new.

Live-verified against a temporary local server instance (isolated port 5099, real dev DB) with a throwaway user, one bike, and 4 accessories exercising every rule above. All fixtures (1 user, 1 bike, 4 accessories) cleaned up afterward via a temporary in-tree script (`src/scripts/__tmpSpec25Cleanup.ts`, reusing the app's own `config`/`mongoose.connect`, deleted immediately after running — same pattern as every prior spec's cleanup pass this session).
