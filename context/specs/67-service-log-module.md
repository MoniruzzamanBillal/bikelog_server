# Spec 67 — Service Log module (warranty + regular servicing)

> Status: **in progress** (backend only). Source brief: root `service-log-module-plan.md`.
> App + web halves are **out of scope** for this spec — not touched, not modified.

## Why

The API logs fuel, mileage, engine oil, maintenance and spending, but has **no way to
record workshop services**. The developer's bike is under a 2-year warranty requiring
**5 scheduled services (~every 3 months); missing one voids the warranty**. Servicing does
not stop at 5 — regular services continue afterward, at the official **or a local** center.

A service may carry paid additives/accessories (`carbon cleaner ৳300`) or nothing at all
(free service), optional technician **recommendations** for the future
(`change air filter next service ~15 Feb`), and the center's **estimated next-service due
date** — which differs from the actual visit date (due 15 Feb, went 17 Feb).

Goal: a new **Service** module, modeled as a **warranty-aware open-ended log**, mirroring
the `engineOilLog` module's conventions.

## Decisions

1. **Warranty-aware open log** — unlimited services; each tagged `warranty` (counts toward 5) or `regular`. A `/status` endpoint reports warranty progress (X of 5, next due,
   void-risk when an upcoming warranty service is already overdue). Regular services are
   just logged — any center, no deadline.
2. **Line items inside each service** — `items: [{ id, name, cost }]`; zero items = free
   service. Costs live in the row's JSON, not a child table (see §Data model note).
3. **Trackable recommendations** — `recommendations: [{ id, text, targetDate?,
targetOdometer?, done }]`; pending ones with a `targetDate` surface as reminders.
4. **Spending** — item costs of **completed** services sum into Spending as a new
   **"Service"** category, and push to expenseTracker2 on completion.
5. **Two dates** — `dueDate` (expected/scheduled) + `serviceDate` (actual visit, set on
   completion). A row with a `serviceDate` is `completed`; one with only a `dueDate` is
   `upcoming` — `status` is **derived from `serviceDate` presence**, never trusted from the
   client.

## Data model — `prisma/schema.prisma`

Three enums + `model ServiceLog`, following `EngineOilLog` conventions (string `@id` no
`@default`, `@@map` snake_case, soft delete, `onDelete: Restrict` on the bike relation,
`serviceLogs ServiceLog[]` back-relation on `model Bike`):

```prisma
enum ServiceKind       { warranty regular }
enum ServiceStatus     { upcoming completed }
enum ServiceCenterType { official local }

model ServiceLog {
  id              String             @id
  bikeId          String
  serviceKind     ServiceKind        @default(regular)
  warrantyNumber  Int?               // 1..5, only when serviceKind = warranty
  status          ServiceStatus      @default(upcoming)
  dueDate         DateTime?          // expected/target (center's estimate)
  serviceDate     DateTime?          // actual visit (set on completion)
  odometerReading Float?             // at service (set on completion)
  serviceCenter   String?
  centerType      ServiceCenterType?
  items           Json?              // [{ id, name, cost }]
  recommendations Json?              // [{ id, text, targetDate?, targetOdometer?, done }]
  notes           String?
  serviceImage    Json?              // receipt { url, publicId }
  isDeleted       Boolean            @default(false)
  createdAt       DateTime           @default(now())
  updatedAt       DateTime           @updatedAt

  bike Bike @relation(fields: [bikeId], references: [id], onDelete: Restrict)

  @@index([bikeId])
  @@index([bikeId, dueDate])
  @@map("service_logs")
}
```

**`items`/`recommendations` are JSON arrays on the row, not child tables** — deliberate:
tiny per-bike volume, one table / one additive migration, mirrors the existing
`serviceImage Json` precedent. Each sub-entry carries its own generated `id` (bson hex) so
a recommendation can be toggled/keyed individually. **Item costs are plain JSON numbers,
not `Decimal(12,2)`** — JSON cannot hold a Prisma Decimal; input is bounded + rounded to 2dp
in validation, and every read goes through `Number(...)` before arithmetic, so it stays
consistent with the Decimal columns it is summed beside. Trade-off accepted: less queryable
than a relational child table; revisit only if cross-bike item querying is ever needed.

### Migration — applied by the operator, never `migrate dev`

`prisma/migrations/<ts>_add_service_logs/migration.sql` is **hand-written, additive**
(CREATE TYPE ×3 + CREATE TABLE + 2 indexes + FK). It is NOT applied to any database in this
spec. Apply with `yarn db:migrate` (`prisma migrate deploy`). **Never run `prisma migrate
dev` against this Neon database** — it offers to reset on drift (repo standing rule). The
Prisma client is regenerated locally with `npx prisma generate` (offline, no DB) so `tsc`
sees `prisma.serviceLog`.

## Server module — `src/app/modules/serviceLog/` (mirror `engineOilLog`)

Six files: `serviceLog.{route,controller,service,validation,interface,utils}.ts`.
Register in `src/app/router/index.ts`:
`{ path: "/bikes/:bikeId/service-logs", route: serviceLogRouter }`.

**Routes** (`Router({ mergeParams: true })`, every route `authCheck`; writes
`validateRequest`; literal `/status` **before** `/:id` — Express matches in registration
order, §0 H1 of the oil module):

- `GET /` — paginated list via `buildPrismaListQuery` (`baseWhere: { bikeId, isDeleted:
false }`, default sort `-serviceDate`, strip `bike`/`isDeleted` from the query).
- `GET /status` — warranty progress summary (below).
- `POST /` — create.
- `PATCH /:id` — update (also completes an upcoming service, and toggles a recommendation's
  `done` by re-submitting the array).
- `DELETE /:id` — soft delete.
- `PUT /:id/image` — receipt upload (`upload.single("image")`), mirror engine oil.
- `DELETE /:id/image` — remove receipt.

**Service layer** — every function opens with `findOwnedBikeOrThrow(bikeId, userId)` (404,
not 403). IDs via `generateObjectId()`, incl. each item/recommendation sub-entry missing
one. `toApiShape` remaps `id→_id`, `bikeId→bike`, item/recommendation costs → `Number`.

- **Create**: `status` derived from `serviceDate` presence. If `serviceKind === "warranty"`
  and `warrantyNumber` omitted → auto-assign `count(live warranty rows) + 1`. On a
  completed create with `odometerReading` → `bumpOdometerIfHigher(bike, reading)`.
- **Update**: re-derive `status` if `serviceDate` changes; recompute item ids; bump
  odometer if a higher `odometerReading` arrives. Returns a `justCompleted` flag (was not
  `completed` before, is now) so the controller fires the expense push exactly once.
- `getServiceStatus`: pure `summarizeWarranty(rows, now)` over all live rows →
  `{ warrantyTotal: 5, warrantyCompleted, warrantyLogged, nextWarranty?: { number, dueDate,
status }, nextService?: { dueDate, status }, warrantyVoidRisk }`. `status` of a dated row
  = `overdue` if `dueDate < now`, else `upcoming`.

**Validation** (Zod `z.object({ body })`): separate create/update schemas. `items` array of
`{ name, cost? }` (cost `.finite().nonnegative().max(...)`), `recommendations` array of
`{ text, targetDate?, targetOdometer?, done? }`, `warrantyNumber` int 1–5 optional,
`serviceKind`/`centerType` enums, dates `z.coerce.date()`. Create requires **at least one**
of `dueDate`/`serviceDate` (a service is either scheduled or done). `status` and
`warrantyNumber` auto-assignment are server-derived — `status` is never read from the body.

## Cross-cutting server edits (additive)

**Spending** — `spending.service.ts` `computeSpendingForRange`:

- 5th `findMany` in the `Promise.all`: `serviceLog` where `{ bikeId, isDeleted: false,
status: "completed", ...(serviceDate range) }`.
- `serviceTotal` = Σ over each row's `items[]` costs.
- Push `{ category: "Service", total: serviceTotal }` guarded `> 0`.
- Add `serviceTotal` into `totalSpending` (computed separately from the array — easy miss).
- `serviceRecords`: **one record per item** (`date: serviceDate`, `category: "Service"`,
  `description: item.name`, `amount: Number(item.cost)`, `vendor: serviceCenter`,
  `source: "service"`, `liters: null`) into `records`. Add `"service"` to
  `TSpendingRecordSource` (`spending.interface.ts`). Only completed services contribute;
  an upcoming (scheduled, not visited) service is excluded.

**expenseTracker** — `transactionRequestSummary.ts`: `buildServiceLogSummary` (title
`Service: warranty #N` / `Service`, description = item names + center). Controller fires
`notifyExpenseTracker` **only when `justCompleted` and item total > 0**, one event,
`amount` = item sum, `occurredAt` = serviceDate, `sourceType: "maintenance"` (reuse the
validated union — expenseTracker2 is out of this cascade; dedupe keys on `sourceRecordId`,
which is the service id).

**Reminders** — `maintenanceLog.service.ts` `getRemindersFromDB` re-source block (mirrors
the engine-oil block): append service reminders from `serviceLog.utils`'
`getServiceRemindersFromDB(bikeId, currentOdometer)`, in the existing
`{ maintenanceType: { _id, name }, lastServiceDate, lastOdometerReading, nextDueDate,
daysRemaining, status }` shape so both clients' banners render them with **no client
change**:

- Earliest `upcoming` service row with a `dueDate` → a date reminder (`_id` = row id,
  `name` = `Warranty service #N` or `Next service`). Overdue if past, upcoming if ≤14 days
  (same rule as maintenance date reminders).
- Each pending recommendation (`done === false`) with a `targetDate` → a reminder
  (`_id` = recommendation id, `name` = recommendation text), same overdue/≤14-day rule.

## Web client — `bikelog_client-web-`

**No change** (cascade step 3 untriggered): routes are new, the spending change is additive
(web renders whatever categories/records the server returns), the expenseTracker union is
unchanged. Not touched in this spec.

## App — `bikelog_app`

**No change in this spec — explicitly out of scope.** The developer asked for backend only.
The app continues to work unchanged; the new routes simply go unconsumed until a future app
spec. The reminders/spending edits are shaped so no app change is required for them either.

## Verification

- `npx prisma generate` (offline) → `yarn build` (tsc clean).
- `yarn test` (Vitest) — add DB-free unit tests for the pure helpers: `nextWarrantyNumber`,
  `sumItemCosts`, `deriveStatus`, `dueState`, `summarizeWarranty`.
- `yarn lint` — no new errors.
- **Operator / Postman (not run here)**: create upcoming → complete on a different actual
  date → add items + recommendation → `/status` shows X-of-5 + next due → toggle a
  recommendation → `/reminders` shows it → `/spending-summary` shows "Service". Confirm
  another user's `bikeId` → 404, and an upcoming (uncompleted) service excluded from
  spending.

**Deploy**: purely additive, no ordering constraint. Migration is manual (`yarn db:migrate`
with the unpooled URL). No client build needed — backend only.
