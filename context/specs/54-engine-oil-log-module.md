# 54: Engine oil log — a module of its own, with the history carried over

Status: 📝 **Plan only — written 2026-10-18, awaiting developer review. No code written.**
Requested directly by the developer (2026-10-18): _"currently from the maintenance, i add engine oil. now i want it a separate module, but i don't want the previous data to be lost. and as from setting page i can update odometer reading, so based on the updated odometer reading in the engine oil log i should see updated data. also in the fuel log i can see possible date when my fuel is half — in engine oil page, i want to show the possible date of my engine oil change."_

Paired with `bikelog_client-web-` spec 33 (the screens). **Revised 2026-10-18** after the developer answered spec 33's open questions: answer 3 (“yes, build both oil-only extras”) adds D12 and the two per-row fields in §C below; answers 1 and 2 are client-only and live in spec 33. **`bikelog_app` is deliberately not in this round** — the developer will test the web half first and the app half becomes its own spec afterwards. Everything below is designed so that the app keeps working untouched in the meantime (§E is the piece that buys that).

**What this changes, in one line:** an oil change stops being a maintenance log with an oil type bolted on and becomes its own record, with its own screen that answers the one question the trip-B meter answers today — _how far have I run on this oil, and when is the next change due._

Scope: one new module (`src/app/modules/engineOilLog/`), one additive migration, one helper extracted out of `maintenanceLog.service.ts`, three small edits to existing services (spending, reminders, the oil-type delete guard), one import script. No new dependency.

---

## §0 Hazards — read before writing code

**H1 — `GET /status` must be registered before `GET /:id`, or it 404s.**
Express matches in registration order. `router.get("/:id")` happily matches the literal path `status`, the service looks for an engine oil log with id `"status"`, finds none, and throws `404 Engine oil log not found` — with no hint that routing is the problem. Register the static path first. (`maintenanceLog.route.ts` dodges this today only because reminders live on a separate router.)

**H2 — The oil-type FK must be `ON DELETE RESTRICT`. Prisma's default here is the opposite, and the opposite is silent data loss.**
`maintenance_logs.oilTypeId` is `ON DELETE SET NULL` (init migration, L259) — spec 46's hazard H1: hard-deleting a still-referenced oil-type row succeeds and _silently nulls_ every log pointing at it. An optional relation in Prisma defaults to `SetNull`, so the new model gets the same defect unless `onDelete: Restrict` is written explicitly, in the schema **and** in the hand-written migration SQL. There is no reason for this table to inherit a known bug.

**H3 — Between the import's copy step and its finalize step, every historical oil change is counted twice in spending.**
§F makes `computeSpendingForRange` sum the new table. §H's `--apply` copies the old maintenance logs into it, and only `--finalize` soft-deletes the originals. In the window between the two, spending totals, the category breakdown, the trend chart and the PDF export all double-count oil. That is tolerable **only** because it is a read-only, minutes-long window inside one operator session — not something to leave overnight. Run copy → verify → finalize in one sitting, and do the whole thing **before** the web client ships (so nobody is looking at the doubled numbers).

**H4 — After finalize, both clients silently lose the oil reminder they have today, and the app is not in this cascade.**
Reminders are derived entirely from `maintenance_logs` (`getRemindersFromDB`). Soft-delete the source oil entries and the engine-oil reminder vanishes from `bikelog_client-web-`'s `RemindersBanner` _and_ from `bikelog_app`'s — an app this spec is not allowed to touch yet, on a device the developer actually rides with. §E is the fix and it is not optional: the reminders response keeps emitting an engine-oil reminder, now sourced from the new table. Nothing is renamed, removed or retyped, so no client needs a change to keep working.

**H5 — `bike.currentOdometer` lags reality, and here it lags in the direction that makes you late for an oil change.**
It only moves when a fuel log, a maintenance log, an engine oil log or the Settings odometer panel (spec 44) bumps it. Between those, the bike has been ridden further than the stored number, so "km on this oil" is understated and "km remaining" overstated — the projected due date lands late. Same shape as spec 52 H5 and `bikelog_app` spec 55 H-F, same mitigation: **floor** the day count, never `Math.ceil`, and keep the "around" hedge in the client copy. This is also exactly why the status endpoint reads `bike.currentOdometer` **live on every request** and stores no snapshot — that is the developer's "based on the updated odometer reading I should see updated data" requirement, and it is satisfied by not caching, not by anything clever.

**H6 — The interval must be resolved once, at write time, and stored on the log.**
It is tempting to read `oilType.suggestedIntervalKm` live in the status endpoint. Don't: editing a catalog row would then retroactively move the due point of every past change, and soft-deleting the oil type would leave the current oil with no interval at all. `maintenanceLog.intervalKmUsed` already works this way and `bikelog_app` spec 54 exists precisely because a log written _without_ an interval is invisible to every reminder (spec 52 H7). Resolve → store → never re-derive.

**H7 — Some rows to import have no oil type at all, so the column must be nullable even though the form requires it.**
`maintenanceLog.oilType` is optional today (`maintenanceLog.validation.ts:19`), so a maintenance log of a `requiresOilType` type can legitimately sit in production with `oilTypeId: null`. A `NOT NULL` column would make the import choose between dropping those rows and inventing a catalog entry for them — and the developer's one hard constraint is that nothing is lost. The column is nullable at the database level; `createEngineOilLogSchema` requires it for anything entered from now on. The two rules differ on purpose; say so in a comment or someone will "fix" it.

**H8 — After an import, one Cloudinary asset would have two owners.**
Copying `maintenanceLog.serviceImage` into `engineOilLog.receiptImage` copies a `{ url, publicId }` reference, not the file. `DELETE /engine-oil-logs/:id/image` calls `deleteCloudinaryImage(publicId)` — which would break the maintenance log's thumbnail too. Finalize (soft-deleting the source log) is what leaves exactly one live owner, which is a second reason §H's two steps are both mandatory. The import must never re-upload; it copies the reference.

**H9 — `prisma migrate deploy` applies every pending migration, and there is already one pending.**
`20261018061500_add_user_profile_picture` (spec 53) is committed and, per that spec's status line, **not yet applied to production**. Applying this spec's migration therefore applies spec 53's as well. Check `_prisma_migrations` before running anything, expect both, and confirm spec 53's code is deployed first. And the standing rule from spec 46: **never `prisma migrate dev` against this database** — it offers to reset it.

**H10 — Validate the odometer against other oil logs, never against `bike.currentOdometer`.**
Mirror `fuelLog.service.ts`'s `assertOdometerInSequence`: the reading must be ≥ the newest earlier oil log's reading and ≤ the oldest later one's, scoped to this bike's live oil logs. Comparing against `currentOdometer` instead would refuse every legitimate backdated entry — the bug spec 26 fixed and spec 48 wrote down (DEF-12). Backdating is a normal flow here: the first thing the developer will do on this screen is type in the last change they already made.

**H11 — `TSpendingRecordSource` is a wire enum, and both clients' copies are already one value behind.**
`spending.interface.ts:15` is `"fuel" | "maintenance" | "accessory"`; both clients declare `"fuel" | "maintenance"` and never switch on it, so the extra value has been harmless. Adding `"oil"` (§F) stays harmless at runtime for the same reason — but fix the web client's copy in spec 33 and log the app's as a Known Gap rather than leaving two more stale types behind.

**H12 — The oil-type delete guard counts the wrong table the moment this ships.**
`engineOilType.service.ts:149` counts `maintenanceLog` rows to decide whether to refuse a delete with `409` (spec 41). After this spec, an oil type used only by engine oil logs would pass that guard and soft-delete, leaving the current oil's type unresolvable on the status card. §G extends the count; it is four lines and easy to forget.

**H13 — Dates here are day-granular, so "the latest oil change" needs a tie-break.**
Clients submit `yyyy-MM-dd` and `z.coerce.date()` stores exactly `00:00:00.000Z` (documented at length in `buildPrismaListQuery.ts`). Two changes entered on the same day tie, and Postgres leaves ties in no defined order — so the status card could flip between them. Order by `changeDate desc, createdAt desc` everywhere "newest" is meant, exactly as `buildPrismaListQuery` appends `createdAt` for the list endpoints.

**H14 — Do not reach for `?oilTypeId=<id>`-style filtering on the list endpoint.**
`buildPrismaListQuery` drops leftover query params straight into the Prisma `where` with no coercion, so any non-string filter 500s through a `globalErrorHandler` that has no Prisma branch (`bikelog_app` spec 55 H-H found this the hard way with `?isFullTank=true`). Nothing in this spec needs such a filter.

---

## §A Decisions

- **D1 — A real module, not a view over `maintenance_logs`.** New table, new router, the standard 7-file module split (`route`/`controller`/`service`/`interface`/`validation`/`utils`), mirroring `fuelLog` plus `engineOilType`'s `utils` file. The developer asked for a separate module and the extra fields (oil quantity, filter changed) have nowhere to live in `maintenance_logs` anyway.
- **D2 — `oilTypeId` is nullable in the database, required in the create schema.** H7. The update schema accepts it optionally; it may never be set _to_ null through the API.
- **D3 — `intervalKmUsed` is stored per log; the client seeds the field from the catalog and the rider may edit it; the server stores whatever arrives and derives `nextDueOdometer` from it.** H6. Settled with the developer 2026-10-18: _"from the setting page I can add engine oil type and there I add interval km, so from the frontend in the input field that value will be set and it will be user input so I can modify this."_ So the normal path is **client-seeded** — the form pre-fills `suggestedIntervalKm` from the selected oil type and submits whatever the rider leaves in the box. The server's own `?? oilType.suggestedIntervalKm` fallback is a **safety net for callers that omit the field**, not the main path: the import (§H), Postman, and `bikelog_app` before its half ships.
  - **Every oil type has an interval, so there is always something to seed with.** `engineOilType.validation.ts` makes `suggestedIntervalKm` **required and positive** on create — there is no such thing as a catalog entry without one. That is why `bikelog_client-web-` spec 33 can make the form field required rather than inventing a "no interval" affordance.
  - **An update never re-seeds.** `PATCH` with a different `oilType` and no `intervalKmUsed` leaves the stored interval alone; re-reading the catalog there would silently move the due point of a log the rider only meant to relabel. The client re-seeds its visible field and submits the new number if that is what the rider wants (spec 33 §D).
  - **A log with no interval at all is reachable only through the import** — a maintenance log that had none, whose oil type is also gone. It has no due point and never drives the forecast (§D's third state).
- **D4 — The status is computed on read, nothing is stored.** `GET /bikes/:bikeId/engine-oil-logs/status` derives everything from the newest live oil log + `bike.currentOdometer` + the riding rate. H5: this is what makes the Settings odometer update show up immediately, with no recompute job and no stale cache.
- **D5 — Reminders stay the one alert surface; the engine-oil reminder is re-sourced, not removed.** H4. `getRemindersFromDB` gains one additive entry derived from the newest oil log. Both clients' existing banners keep rendering it with zero changes.
- **D6 — `computeKmPerDay` moves to `src/app/util/ridingRate.ts` and both callers import it.** Spec 52's D7 said "move the helper somewhere shared only when a second consumer appears" — this is that second consumer. Same constants, same arithmetic, byte-identical behaviour for reminders: the move is a pure extraction, verified by diffing the function body.
- **D7 — Spending gains an `Engine Oil` category and a `source: "oil"` record type.** The money is real and the bike hub's totals must not drop by the cost of every oil change ever logged. H3 governs the ordering, H11 the client types.
- **D8 — The expenseTracker2 push reuses `sourceType: "maintenance"`.** That union is validated on expenseTracker2's side (`POST /api/transaction-requests/ingest`), and that project is explicitly out of this cascade. Ids never collide, so dedupe on the far side is unaffected. Adding a real `"oil"` source there is a note in Known Gaps, not work in this spec.
- **D9 — The import copies, links and only then hides; it never moves or deletes.** Every imported row carries `importedFromMaintenanceLogId` (unique — so a re-run is a no-op, and so finalize knows exactly what to hide). The source maintenance logs are **soft-deleted**, never hard-deleted, so the whole operation is reversible with one `UPDATE`.
- **D10 — Field set: the fuel-log parity set plus two oil-specific ones.** `quantityLiters` (optional — the import has no value for it), `oilFilterChanged` (boolean, defaults false), `serviceCenter`, `notes`, `receiptImage`. Settled with the developer before implementation, see Open questions.
- **D11 — No notification work.** The weekly summary cron stays fuel-only; an "oil change due" push is a later spec if it is wanted at all.
- **D12 — The list endpoint returns `kmOnThisOil` and `costPerKm` per row (added 2026-10-18).** `bikelog_client-web-` spec 33 §G shows "what the last oil cost to run" on each closed change. The figure needs the row's **neighbour**, and a client deriving it from the page it happens to be holding gets a number that appears and vanishes with pagination — the neighbouring change sits on the previous page at every boundary. One extra `findFirst` per list request settles it for good (§C).

---

## §B Schema + migration

```prisma
model EngineOilLog {
  id                           String    @id
  bikeId                       String
  // H7/D2: nullable in the DB so the import can carry rows that never had a type;
  // required by createEngineOilLogSchema for everything entered from now on.
  oilTypeId                    String?
  odometerReading              Float
  // H6/D3: resolved at write time from the oil type, then frozen on the row.
  intervalKmUsed               Float?
  nextDueOdometer              Float?
  quantityLiters               Float?
  oilFilterChanged             Boolean   @default(false)
  cost                         Decimal   @db.Decimal(12, 2)
  changeDate                   DateTime
  serviceCenter                String?
  notes                        String?
  receiptImage                 Json?
  // D9: provenance for §H's import. Unique, so a second --apply is a no-op.
  importedFromMaintenanceLogId String?   @unique
  isDeleted                    Boolean   @default(false)
  createdAt                    DateTime  @default(now())
  updatedAt                    DateTime  @updatedAt

  bike    Bike           @relation(fields: [bikeId], references: [id])
  // ! H2 — Restrict, NOT the SetNull that maintenance_logs.oilTypeId carries.
  oilType EngineOilType? @relation(fields: [oilTypeId], references: [id], onDelete: Restrict)

  @@index([bikeId])
  @@index([bikeId, changeDate])
  @@map("engine_oil_logs")
}
```

Back-relations to add: `Bike.engineOilLogs EngineOilLog[]` and `EngineOilType.engineOilLogs EngineOilLog[]`.

Migration `prisma/migrations/<ts>_add_engine_oil_logs/migration.sql` — hand-written, additive, no data touched:

```sql
CREATE TABLE "engine_oil_logs" (
  "id"                           TEXT NOT NULL,
  "bikeId"                       TEXT NOT NULL,
  "oilTypeId"                    TEXT,
  "odometerReading"              DOUBLE PRECISION NOT NULL,
  "intervalKmUsed"               DOUBLE PRECISION,
  "nextDueOdometer"              DOUBLE PRECISION,
  "quantityLiters"               DOUBLE PRECISION,
  "oilFilterChanged"             BOOLEAN NOT NULL DEFAULT false,
  "cost"                         DECIMAL(12,2) NOT NULL,
  "changeDate"                   TIMESTAMP(3) NOT NULL,
  "serviceCenter"                TEXT,
  "notes"                        TEXT,
  "receiptImage"                 JSONB,
  "importedFromMaintenanceLogId" TEXT,
  "isDeleted"                    BOOLEAN NOT NULL DEFAULT false,
  "createdAt"                    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "engine_oil_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "engine_oil_logs_importedFromMaintenanceLogId_key"
  ON "engine_oil_logs"("importedFromMaintenanceLogId");
CREATE INDEX "engine_oil_logs_bikeId_idx" ON "engine_oil_logs"("bikeId");
CREATE INDEX "engine_oil_logs_bikeId_changeDate_idx" ON "engine_oil_logs"("bikeId", "changeDate");

ALTER TABLE "engine_oil_logs" ADD CONSTRAINT "engine_oil_logs_bikeId_fkey"
  FOREIGN KEY ("bikeId") REFERENCES "bikes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- ! H2: RESTRICT, deliberately unlike maintenance_logs.oilTypeId's SET NULL
ALTER TABLE "engine_oil_logs" ADD CONSTRAINT "engine_oil_logs_oilTypeId_fkey"
  FOREIGN KEY ("oilTypeId") REFERENCES "engine_oil_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

A `NULL` is not unique-constrained in Postgres, so every non-imported row having `importedFromMaintenanceLogId = NULL` is fine — the unique index only binds the imported ones.

---

## §C The module

`src/app/modules/engineOilLog/` — `engineOilLog.{route,controller,service,interface,validation,utils}.ts`, registered in `src/app/router/index.ts` at `"/bikes/:bikeId/engine-oil-logs"` with `Router({ mergeParams: true })`.

| Method   | Path         | Notes                                                      |
| -------- | ------------ | ---------------------------------------------------------- |
| `GET`    | `/status`    | **Registered first — H1.** The forecast, §D                |
| `POST`   | `/`          | create                                                     |
| `GET`    | `/`          | list, `buildPrismaListQuery`, `defaultSort: "-changeDate"` |
| `GET`    | `/:id`       | single                                                     |
| `PATCH`  | `/:id`       | update                                                     |
| `DELETE` | `/:id`       | soft delete                                                |
| `PUT`    | `/:id/image` | `upload.single("image")`, replaces, deletes the old asset  |
| `DELETE` | `/:id/image` | removes, `Prisma.JsonNull`                                 |

Every route `authCheck`, every service call starts with `findOwnedBikeOrThrow(bikeId, userId)`, every write path resolves the oil type through `findOwnedEngineOilTypeOrThrow(id, userId)` — which already enforces `ownerId` + `isDeleted: false` and 404s (not 403s) on a cross-user id. **Both** create and update must do it; spec 46 §D records that the update path is the IDOR site people miss.

`toApiShape` mirrors `fuelLog.service.ts`'s: spread the row, add `_id: id`, `bike: bikeId`, `Number(cost)`, and populate `oilType` as `{ _id, name }` when included (no `isDeleted` filter on that include — spec 41's rule: a historical log must still resolve the name of a type that has since been deleted).

**The list endpoint adds two derived fields per row (D12).** For each row, its *newer* neighbour closes the period the row opened:

```
kmOnThisOil = newerNeighbour.odometerReading − row.odometerReading     // null when there is no newer change
costPerKm   = kmOnThisOil > 0 ? Number(row.cost) / kmOnThisOil : null   // null, never Infinity — two changes can share an odometer
```

Within a page the neighbour is simply the previous element (the list is `-changeDate`, H13's tie-break included). The page's **first** row is the only one whose neighbour is off-page, so one `findFirst` — newest live log strictly newer than that row — covers it. Two queries per list request, both on `@@index([bikeId, changeDate])`. The newest change of all has no neighbour and both fields are `null`; `GET /:id` returns them as `null` too rather than running the lookup, since nothing consumes them there.

Validation (`engineOilLog.validation.ts`), reusing the bounded `odometerReadingField` from `fuelLog.validation.ts` verbatim (`.finite().nonnegative().max(999999)` — specs 45/48/50):

```ts
createEngineOilLogSchema.body = {
  oilType: z.string({ required_error: "Engine oil type is required" }).min(1), // D2
  odometerReading: odometerReadingField,
  intervalKmUsed: z.number().finite().positive().max(100000).optional(), // D3
  quantityLiters: z.number().finite().positive().max(20).optional(),
  oilFilterChanged: z.boolean().optional(),
  cost: z
    .number({ required_error: "Cost is required" })
    .finite()
    .nonnegative()
    .max(9999999.99),
  changeDate: z.coerce.date().optional(),
  serviceCenter: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
};
// update: every field optional; `oilType` may be re-pointed but never cleared.
// `nextDueOdometer` is absent from BOTH schemas — server-derived only (D3).
```

Create, in order (the order is the point — nothing is written until every check has passed, per spec 48 §D):

1. `findOwnedBikeOrThrow`.
2. `changeDate = payload.changeDate ?? new Date()`; refuse `changeDate < bike.purchaseDate` with a 400 naming the purchase date (spec 50 §4's rule, same message shape as fuel logs).
3. `findOwnedEngineOilTypeOrThrow(payload.oilType, userId)`.
4. `assertOdometerInSequence` over this bike's live oil logs — H10, a direct port of `fuelLog.service.ts`'s, with `excludeId` on the update path so correcting a typo on the newest log still works.
5. `intervalKmUsed = payload.intervalKmUsed ?? oilType.suggestedIntervalKm` (D3 — the client normally sends it; this `??` is the safety net, not the main path); `nextDueOdometer = odometerReading + intervalKmUsed` when an interval exists, else `null`.
6. `prisma.engineOilLog.create` with `generateObjectId()`.
7. `bumpOdometerIfHigher(bike, odometerReading)` — the atomic conditional write from spec 45/49.
8. Return `{ log, bikeNickname }`; the controller fires `notifyExpenseTracker` with `sourceType: "maintenance"` (D8) and a summary built the way `buildFuelLogSummary` builds its one — add a `buildEngineOilLogSummary` next to it in `transactionRequestSummary.ts`.

Update recomputes `nextDueOdometer` whenever `odometerReading` or `intervalKmUsed` moves — and **only then**: changing `oilType` alone must not re-seed the interval (D3) — re-runs the sequence check whenever `odometerReading` or `changeDate` moves, and bumps the odometer when the reading rises. Delete is a soft delete. **No "locked" rule** — unlike fuel logs, nothing downstream closes a period over an oil log, so there is nothing to protect (that is `MileageRecord`'s job and it is untouched here).

---

## §D `GET /bikes/:bikeId/engine-oil-logs/status`

The screen the developer described, as one request. Arithmetic:

```
last             = newest live oil log by (changeDate desc, createdAt desc)        // H13
intervalKm       = last.intervalKmUsed                                             // stored, H6
nextDueOdometer  = last.nextDueOdometer
kmSinceChange    = max(0, bike.currentOdometer - last.odometerReading)             // live read, H5
kmRemaining      = nextDueOdometer - bike.currentOdometer                          // signed
percentUsed      = round(kmSinceChange / intervalKm * 100)
rate             = computeKmPerDay(bikeId)                                         // §D6 shared helper
projectedDays    = rate && kmRemaining > 0 ? floor(kmRemaining / rate.kmPerDay) : undefined   // H5: floor
projectedDueDate = now + projectedDays days
status           = kmRemaining <= 0            -> "overdue"
                 | projectedDays !== undefined -> projectedDays <= 10 ? "upcoming" : "ok"     // spec 52 D2
                 | otherwise                   -> kmRemaining <= 50 ? "upcoming" : "ok"       // spec 52 H6 fallback
```

Worked example — oil changed 12 Aug at 18,400 km, 2,400 km interval, odometer now 19,950, 43.2 km/day:

```
kmSinceChange    = 19,950 - 18,400          = 1,550 km
nextDueOdometer  = 18,400 + 2,400           = 20,800 km
kmRemaining      = 20,800 - 19,950          =   850 km
percentUsed      = 1,550 / 2,400            =    65 %
projectedDays    = floor(850 / 43.2)        =    19  ->  "around 6 Nov"
status           = 19 > 10                  ->  "ok"
```

Response (every field below is new, so there is no existing consumer to break):

```jsonc
{
  "status": "ok", // "ok" | "upcoming" | "overdue" | "unknown"
  "currentOdometer": 19950,
  "lastChange": {
    "_id": "...",
    "changeDate": "2026-08-12T00:00:00.000Z",
    "odometerReading": 18400,
    "oilType": { "_id": "...", "name": "Motul 7100 10W-40" },
    "intervalKm": 2400,
    "nextDueOdometer": 20800,
    "oilFilterChanged": true,
  },
  "kmSinceChange": 1550,
  "kmRemaining": 850, // signed — negative means past due, see note
  "percentUsed": 65,
  "projectedDaysRemaining": 19, // omitted when no rate, or when overdue
  "projectedDueDate": "2026-11-06T...", // omitted with it
  "kmPerDay": 43.2, // 1dp, spec 52 D6: without it a wrong date is undebuggable
  "rateBasis": { "spanDays": 28, "distanceKm": 1210 }, // what the rate was measured over
}
```

Three states that are not errors and each need a defined shape, not a `null` the client has to guess at:

- **No oil log yet** → `{ status: "unknown", lastChange: null, currentOdometer }`. The client shows a "log your last oil change" CTA.
- **A log with no interval** (H7's imported row) → `lastChange` present, `kmSinceChange` present, `intervalKm`/`kmRemaining`/`percentUsed` and the whole projection omitted, `status: "unknown"`. The client can still say "1,550 km on this oil" which is most of the value.
- **No usable riding rate** (new bike, <2 fuel logs in 28 days, <100 km covered) → the distance fields stay, the three projection fields are omitted, `status` falls back to the 50 km rule. The client prints the km and no date.

`kmRemaining` is returned **signed**, deliberately unlike `getRemindersFromDB`'s clamped `Math.max(0, …)` — the web banner already has to reconstruct the overshoot from `currentOdometer` to print "X km past due" (`RemindersBanner.tsx:35-38`). A new endpoint has no back-compat to preserve, so it returns the honest number and spec 33 does no reconstruction.

---

## §E Reminders keep working — one additive entry (H4)

In `getRemindersFromDB`, after the maintenance loop, read the newest live engine oil log (same ordering as §D) and, if it has a `nextDueOdometer` and clears the same overdue/upcoming test, push one more reminder in the **existing shape**:

```ts
{
  maintenanceType: { _id: log.oilTypeId ?? log.id, name: log.oilType?.name ?? "Engine oil" },
  lastServiceDate: log.changeDate,
  lastOdometerReading: log.odometerReading,
  nextDueOdometer, kmRemaining: Math.max(0, kmRemaining), status,
  ...projection                      // same three optional fields spec 52 added
}
```

Both clients key reminders off `maintenanceType._id` and resolve the display name from `maintenanceType.name` when it is an object (`RemindersBanner.tsx:14-25`), which this is — so the entry renders correctly with **no client change**, in the web app and in the untouched mobile app. Reuse the same `rate` already computed once per request; do not call the helper twice.

One consequence worth stating out loud: between `--apply` and `--finalize`, the oil reminder appears **twice** — once from the still-live maintenance log, once from here. Same minutes-long window as H3, same answer.

---

## §F Spending (D7)

In `computeSpendingForRange`, add a fourth `prisma.engineOilLog.findMany` to the existing `Promise.all` (range-filtered on `changeDate`, `isDeleted: false`), then:

- `oilTotal` into `totalSpending` alongside fuel, maintenance and accessories — it is currently summed as `fuelTotal + maintenanceTotal + accessoryTotal` at `spending.service.ts:126`, which is easy to miss because the category array is built separately.
- a `{ category: "Engine Oil", total }` entry, only when `> 0` (the accessories precedent).
- one `TSpendingRecord` per log: `date: changeDate`, `category: "Engine Oil"`, `description` = the oil type name + `" · filter changed"` when true, `vendor: serviceCenter`, `remarks: notes`, `source: "oil"`.
- `TSpendingRecordSource` gains `"oil"` (H11).

`Number(log.cost)` on every read — a Prisma `Decimal` does not do arithmetic through `+` (the comment at `spending.service.ts:96` exists because this was got wrong before).

The AI spending insight and the PDF export read the same computed structures, so both pick this up with no further change.

---

## §G The oil-type delete guard (H12)

`engineOilType.service.ts:149` currently counts `maintenanceLog` rows with the oil type in use. Make it count both tables (`Promise.all` of two `count`s, or one `count` per table short-circuited) and keep the existing `409` message, widened to say where it is used. Without this, an oil type still referenced by engine oil logs soft-deletes cleanly, and the status card loses the name of the oil currently in the engine. Same guard shape, four more lines.

---

## §H The import — `src/scripts/importOilMaintenanceLogsToEngineOilLogs.ts`

Modelled on `backfillCatalogOwners.ts` (spec 46): **dry-run by default**, `--apply` to write, a deliberately separate `--finalize`, a `--bike=<id>` narrowing flag for a first cautious run, and a printed summary in every mode.

**What it selects.** Live maintenance logs (`isDeleted: false`) that are oil changes, i.e. `oilTypeId IS NOT NULL` **OR** `maintenanceType.requiresOilType = true`. The `OR` matters: the second arm catches logs entered before an oil type was ever chosen (H7), and the first catches logs whose type has since had the flag turned off.

**`--apply`** inserts one `engine_oil_logs` row per selected log:

| Source (`maintenance_logs`)                                                | Target (`engine_oil_logs`)                                                                                |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `id`                                                                       | `importedFromMaintenanceLogId` (new `generateObjectId()` for `id`)                                        |
| `bikeId`, `oilTypeId`, `odometerReading`, `cost`, `serviceCenter`, `notes` | same                                                                                                      |
| `serviceDate`                                                              | `changeDate`                                                                                              |
| `intervalKmUsed`                                                           | same; when `null`, fall back to the oil type's current `suggestedIntervalKm`, else leave `null` (D3)      |
| `nextDueOdometer`                                                          | recomputed from the resolved interval rather than copied, so the two can never disagree                   |
| `serviceImage`                                                             | `receiptImage` — **reference only**, H8                                                                   |
| —                                                                          | `quantityLiters: null`, `oilFilterChanged: false` (unknowable; the developer can edit any row afterwards) |

Idempotent by the unique `importedFromMaintenanceLogId`: skip any source id already present, and report the skips rather than failing.

**Verify between the steps** (the script prints these; run them by eye too):

```sql
SELECT count(*) FROM maintenance_logs m JOIN maintenance_types t ON t.id = m."maintenanceTypeId"
  WHERE m."isDeleted" = false AND (m."oilTypeId" IS NOT NULL OR t."requiresOilType" = true);
SELECT count(*) FROM engine_oil_logs WHERE "importedFromMaintenanceLogId" IS NOT NULL;
-- the two counts must match, and the sums must match to the paisa:
SELECT sum(cost) FROM engine_oil_logs WHERE "importedFromMaintenanceLogId" IS NOT NULL;
```

**`--finalize`** sets `isDeleted = true` on exactly the source logs named by `importedFromMaintenanceLogId` — nothing else, no hard delete. Reversal is one statement:

```sql
UPDATE maintenance_logs SET "isDeleted" = false
 WHERE id IN (SELECT "importedFromMaintenanceLogId" FROM engine_oil_logs WHERE "importedFromMaintenanceLogId" IS NOT NULL);
```

**And the trap this repo has already paid for once:** `$queryRaw` against `information_schema`/`pg_catalog` needs explicit `::text` casts — `table_name`, `is_nullable` and `indexname` are Postgres `name`/`yes_or_no` types and the `PrismaNeon` adapter throws `Failed to deserialize column of type 'name'` on them. That defect made `backfillCatalogOwners.ts` abort on its first query in every mode after passing both `yarn build` and `yarn lint`. If this script introspects anything, cast it; better, don't introspect at all.

---

## §I Postman + docs

- New `Engine Oil Logs` folder in `postman/bikelog-api.postman_collection.json` — the 8 requests of §C, sitting after `Maintenance Logs`, following the existing `{{baseUrl}}` / `{{bikeId}}` / bearer-token variable conventions.
- `postman/dummy-data.md` gains the per-endpoint required/optional/forbidden field table — both clients' specs are told to treat that file as the authoritative field list, so it is not optional documentation.
- `context/architecture.md` module list, `context/progress-tracker.md` (status row + Recent Activity + the two Known Gaps from D8/H11), and `CLAUDE.md`'s module count (15 → 16).

---

## Test plan

No test suite exists, so this is `yarn build` + clean `yarn lint` + a Postman pass. **V5–V8 are the ones that catch the hazards that static checks cannot.**

| #   | Check                                                                                      | Expect                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | `POST` with a valid oil type, no `intervalKmUsed`                                          | 201, `intervalKmUsed` = the type's `suggestedIntervalKm`, `nextDueOdometer` = reading + that                                                              |
| V2 | `POST` with an explicit `intervalKmUsed` **different from the type's suggestion** | the explicit value is stored verbatim and drives `nextDueOdometer`; the catalog value is ignored (D3 — this is the normal web path) |
| V2b | `PATCH` changing only `oilType`, no `intervalKmUsed` | `intervalKmUsed` and `nextDueOdometer` **unchanged** — no silent re-seed (D3) |
| V2c | Edit an oil type's `suggestedIntervalKm` in Settings, then `GET /status` | the existing log's due point is **unmoved** (H6); only the next log entered picks up the new suggestion |
| V3  | `POST` with another user's `oilType` id                                                    | **404**, not 403 and not 201                                                                                                                              |
| V4  | `POST` with `odometerReading` below an earlier oil log's                                   | 400 naming the previous reading                                                                                                                           |
| V5  | `GET /status` **before** `GET /:id` is hit — i.e. with both registered                     | the forecast, not `404 Engine oil log not found` (H1)                                                                                                     |
| V6  | `PATCH /bikes/:id/odometer` (+300 km), then `GET /status` again                            | `kmSinceChange` +300, `kmRemaining` −300, date pulled earlier. **This is the developer's stated requirement; verify it by hand, not by reading the code** |
| V7  | `GET /status` on a bike with one fuel log in 28 days                                       | distance fields present, all three projection fields absent, no `NaN`/`Infinity`/`Invalid Date` anywhere                                                  |
| V8  | `GET /status` where the newest oil log has `intervalKmUsed: null`                          | `status: "unknown"`, `kmSinceChange` present, no projection, no 500                                                                                       |
| V9  | Two oil logs on the same calendar day                                                      | `/status` picks the later-`createdAt` one consistently across 5 calls (H13)                                                                               |
| V9b | `kmOnThisOil` / `costPerKm` on three consecutive changes | match the hand arithmetic; the **newest** row returns `null` for both (D12) |
| V9c | `?page=2` on a bike with 12+ oil logs | page 2's **first** row still carries a real `costPerKm` — the off-page neighbour was fetched |
| V9d | Two changes at the same odometer | `costPerKm: null`, never `Infinity` |
| V10 | `GET /bikes/:id/reminders` after the import                                                | the engine-oil reminder is present and renders unchanged in the **existing** web banner (H4/§E)                                                           |
| V11 | Spending lifetime total, before the import and after `--finalize`                          | **identical to the paisa**; the `Engine Oil` category appears and the old maintenance category drops by the same amount (H3)                              |
| V12 | `DELETE /engine-oil-types/:id` for a type used only by an oil log                          | **409**, not 200 (H12/§G)                                                                                                                                 |
| V13 | `/bikes/:id/reminders` diffed before and after the `computeKmPerDay` extraction, same data | byte-identical response (D6 is a pure move)                                                                                                               |
| V14 | Import dry-run, then `--apply`, then `--apply` again                                       | second run writes nothing and reports N skips                                                                                                             |
| V15 | `PUT /:id/image` then `DELETE /:id/image` on an imported row **after** finalize            | the asset is deleted and no live maintenance log references it (H8)                                                                                       |

Operator steps, in order, all manual: apply the migration (`yarn db:migrate` — and see H9 about spec 53's pending one) → deploy → import dry-run → `--apply` → run the three verify queries → `--finalize` → re-check spending → then ship `bikelog_client-web-` spec 33.

---

## Open questions for the developer

1. **Field set (D10).** `quantityLiters`, `oilFilterChanged`, `serviceCenter`, `notes`, receipt photo — right set? Anything here you would not fill in is worth dropping now rather than after the migration.
2. **Should an oil change also be due on time, not just distance?** Oil ages in the sump. `EngineOilType` has only `suggestedIntervalKm` today; adding an optional `suggestedIntervalDays` (and a `nextDueDate` on the log) is a small addition **now** and an awkward one later. Not in this plan as written.
3. **After the import, do you want the Maintenance screen to still show the old oil entries?** This plan says no — that is what `--finalize` does, and it is what keeps spending honest (H3). They stay in the database, soft-deleted and one `UPDATE` from coming back.
4. **Timing of the app half.** Everything here is built so the app keeps working untouched (§E), but the app will not have the new screen or the forecast until its own spec. Fine to leave it a week?
5. **`new Features/03-offline-fuel-logging.md` is still the one unconsumed brief** — unrelated to this, just noting it has not been forgotten.
