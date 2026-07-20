# Bike Log API — Postman dummy data reference

Companion doc for `bikelog-api.postman_collection.json`. Every example body below matches what's already filled into the collection — this file exists so you can see the _why_ (required vs optional fields, what's rejected/ignored) without having to open each request in Postman.

## How to use

1. Import `bikelog-api.postman_collection.json` into Postman.
2. Check the collection variable `baseUrl` (collection → Variables tab) — defaults to `http://localhost:5000/api`. Change the port if your `.env`'s `PORT` isn't `5000`.
3. Run requests in this order the first time, top to bottom — each one's test script auto-captures an id into a collection variable that later requests depend on:
   1. **Auth → Register** (only once — a second run 409s since the email already exists)
   2. **Auth → Login** — captures `token`
   3. **Bikes → Create Bike** — captures `bikeId`
   4. **Maintenance Types → Create Maintenance Type** — captures `maintenanceTypeId`
   5. **Engine Oil Types → Create Engine Oil Type** — captures `engineOilTypeId`
   6. **Fuel Logs → Create Fuel Log** — captures `fuelLogId`
   7. **Maintenance Logs → Create Maintenance Log** — captures `maintenanceLogId`
4. After that, every other request (list/get/update/delete, mileage, reminders, spending) works as-is. Re-run any `Create` request any time to refresh its captured id.
5. Auth is Bearer `{{token}}` at the collection level — you don't need to set headers manually on each request.
6. `Bikes → Delete Bike` soft-deletes the bike everything else chains off of — run it last, if at all.

If you'd rather seed the two catalog collections instead of creating your own via Postman, run `yarn seed:maintenance-types` and `yarn seed:engine-oil-types` from `bikelog_server/`, then use `List Maintenance Types` / `List Engine Oil Types` to grab a real `_id` and paste it over `{{maintenanceTypeId}}` / `{{engineOilTypeId}}` manually.

---

## Auth (`/api/auth`)

### `POST /api/auth/register` — no auth

```json
{
  "name": "Test Rider",
  "email": "rider@example.com",
  "password": "test1234"
}
```

`password` must be ≥ 6 characters. Response `data` never includes the password hash (fixed in a later audit pass — see `context/progress-tracker.md`). A duplicate email returns `409 Conflict`, not `500`.

### `POST /api/auth/login` — no auth

```json
{
  "email": "rider@example.com",
  "password": "test1234"
}
```

**Response shape is different from every other endpoint**: `{ success, message, data: null, token: "<jwt>" }` — the JWT is a top-level `token` field, not `data.token`. The collection's test script reads it from there.

### `GET /api/auth/me` — auth required

No body. Returns the logged-in user (password excluded).

---

## Bikes (`/api/bikes`)

### `POST /api/bikes` — auth required

```json
{
  "nickname": "Red Beast",
  "brand": "Yamaha",
  "model": "FZS V3",
  "registrationNumber": "DHAKA-METRO-GA-11-2233",
  "purchaseDate": "2024-01-15",
  "fuelTankCapacityLiters": 12,
  "currentOdometer": 1500
}
```

| Field                                              | Required | Notes                                                                                      |
| -------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| `nickname`, `brand`, `model`, `registrationNumber` | yes      | strings                                                                                    |
| `purchaseDate`                                     | yes      | ISO date string                                                                            |
| `fuelTankCapacityLiters`                           | yes      | positive number                                                                            |
| `currentOdometer`                                  | no       | nonnegative number, defaults to 0; becomes the bike's immutable `initialOdometer` snapshot |

**Never send** `owner` — it's taken from the JWT (`req.user.userId`), not the body.

### `GET /api/bikes` — auth required

Lists bikes owned by the logged-in user. No params.

### `GET /api/bikes/:id` — auth required

### `PATCH /api/bikes/:id` — auth required

Same fields as create, all optional. Example:

```json
{
  "nickname": "Red Beast MK2",
  "fuelTankCapacityLiters": 13
}
```

**`owner` and `currentOdometer` are silently stripped server-side even if included** — `currentOdometer` only bumps upward automatically via fuel/maintenance logs, it's not directly PATCH-able.

### `DELETE /api/bikes/:id` — auth required

Soft delete (`isDeleted: true`). No body.

---

## Fuel Logs (`/api/bikes/:bikeId/fuel-logs`)

### `POST .../fuel-logs` — auth required

```json
{
  "odometerReading": 1550,
  "litersAdded": 8.5,
  "isFullTank": true,
  "pricePerLiter": 125.5,
  "fuelStation": "Padma Filling Station",
  "date": "2026-07-01",
  "notes": "Full tank before highway trip"
}
```

| Field                  | Required | Notes                                         |
| ---------------------- | -------- | --------------------------------------------- |
| `odometerReading`      | yes      | number                                        |
| `litersAdded`          | yes      | positive number                               |
| `isFullTank`           | yes      | boolean — drives mileage-record closing logic |
| `pricePerLiter`        | yes      | positive number                               |
| `fuelStation`, `notes` | no       | strings                                       |
| `date`                 | no       | defaults to now; use for back-logging         |

**Never send `totalCost`** — the Zod schema technically accepts it, but the service always overwrites it with `litersAdded * pricePerLiter` server-side and discards whatever you send (this was a real bug fixed in a later audit — see `context/progress-tracker.md`'s "Recent Activity").

Response is `{ data: { fuelLog, mileageRecordClosed } }` — note the extra nesting under `fuelLog`, unlike every other create endpoint.

### `GET .../fuel-logs` — auth required

Query params (all optional): `page`, `limit` (pagination), `sort` (default `-date`), plus generic filter fields. `bike` and `isDeleted` query keys are explicitly ignored server-side — a fixed IDOR meant a client could once override the ownership filter through them; that's now blocked.

### `GET .../fuel-logs/:id`, `PATCH .../fuel-logs/:id`, `DELETE .../fuel-logs/:id` — auth required

Update body: same fields as create, all optional. `totalCost` still forbidden/ignored on update. Update/delete both 409 if the fuel log is already part of a closed mileage record (i.e. was used to compute a prior full-tank period).

---

## Mileage (`/api/bikes/:bikeId/mileage`) — read-only, no write endpoints

| Route                   | Query params                                                  |
| ----------------------- | ------------------------------------------------------------- |
| `GET /mileage`          | none — exact history + rolling average                        |
| `GET /mileage/monthly`  | `targetMonth` **required**, format `YYYY-MM` (e.g. `2026-07`) |
| `GET /mileage/yearly`   | `targetYear` **required**, format `YYYY` (e.g. `2026`)        |
| `GET /mileage/lifetime` | none                                                          |

All mileage records are auto-created when a full-tank fuel log closes a period — there is no `POST` here to fake data for; create a few `isFullTank: true` fuel logs instead if you want mileage data to show up.

---

## Maintenance Types (`/api/maintenance-types`) — catalog, not per-bike

### `POST /api/maintenance-types` — auth required

```json
{
  "name": "Suspension Check",
  "defaultIntervalKm": 5000,
  "defaultIntervalDays": null
}
```

`name` required; `defaultIntervalKm`/`defaultIntervalDays` optional, positive numbers or `null`.

**Already-seeded types** (via `yarn seed:maintenance-types`) — use these names/ids if you don't want to create your own:
| name | defaultIntervalKm | defaultIntervalDays |
|---|---|---|
| Engine Oil | – | – |
| Chain Lube | 500 | – |
| Tire Change | – | – |
| Brake Pads | – | – |
| General Service | 3000 | – |
| Insurance | – | 365 |
| Registration/Tax | – | 365 |
| Other | – | – |

### `GET /api/maintenance-types` — auth required

Lists all maintenance types (not scoped to a bike — shared catalog).

---

## Engine Oil Types (`/api/engine-oil-types`) — catalog, not per-bike

### `POST /api/engine-oil-types` — auth required

```json
{
  "name": "Fully Synthetic 10W-40",
  "suggestedIntervalKm": 1200
}
```

Both fields required; `suggestedIntervalKm` positive.

**Already-seeded types** (via `yarn seed:engine-oil-types`):
| name | suggestedIntervalKm |
|---|---|
| Mineral | 800 |
| Semi-Synthetic | 1000 |
| Synthetic | 1250 |

### `GET /api/engine-oil-types` — auth required

---

## Maintenance Logs (`/api/bikes/:bikeId/maintenance-logs`)

### `POST .../maintenance-logs` — auth required

```json
{
  "maintenanceType": "<a real MaintenanceType _id>",
  "odometerReading": 1800,
  "oilType": "<a real EngineOilType _id, optional>",
  "intervalKmUsed": 3000,
  "nextDueDate": "2026-10-01",
  "cost": 1500,
  "serviceDate": "2026-07-15",
  "serviceCenter": "City Bike Care",
  "partsReplaced": ["Oil Filter", "Engine Oil"],
  "notes": "Routine service"
}
```

| Field                                       | Required | Notes                                                    |
| ------------------------------------------- | -------- | -------------------------------------------------------- |
| `maintenanceType`                           | yes      | ObjectId ref to a `MaintenanceType` — must already exist |
| `odometerReading`, `intervalKmUsed`, `cost` | yes      | numbers (`cost` nonnegative)                             |
| `oilType`                                   | no       | ObjectId ref to an `EngineOilType` if provided           |
| `nextDueDate`, `serviceDate`                | no       | dates; `serviceDate` defaults to now                     |
| `serviceCenter`, `notes`                    | no       | strings                                                  |
| `partsReplaced`                             | no       | array of strings                                         |

`maintenanceType`/`oilType` are real Mongo ObjectIds referencing other collections — they can't be made up. The Postman collection uses `{{maintenanceTypeId}}` / `{{engineOilTypeId}}`, auto-filled by the `Create Maintenance Type`/`Create Engine Oil Type` requests (or paste in a seeded catalog id from the `List` requests).

**Never send `nextDueOdometer`** — always computed server-side as `odometerReading + intervalKmUsed`; any client value is dropped.

### `GET .../maintenance-logs` — auth required

Same query support as fuel logs: `page`, `limit`, `sort` (default `-serviceDate`), generic filters. `bike`/`isDeleted` query keys are ignored server-side for the same IDOR-hardening reason as fuel logs.

### `GET .../maintenance-logs/:id`, `PATCH .../maintenance-logs/:id`, `DELETE .../maintenance-logs/:id` — auth required

Update body: same fields as create, all optional. Example update:

```json
{
  "cost": 1600,
  "notes": "Updated cost after parts price change"
}
```

### `GET /api/bikes/:bikeId/reminders` — auth required

No body, no query params. Computed on read by comparing the bike's `currentOdometer`/today's date against the latest logged `nextDueOdometer`/`nextDueDate` per maintenance type.

---

## Spending Summary (`/api/bikes/:bikeId/spending-summary`)

`GET` only, query params (no body):

| param         | required                   | notes                                                           |
| ------------- | -------------------------- | --------------------------------------------------------------- |
| `period`      | yes                        | exactly one of `month`, `year`, `lifetime` — anything else 400s |
| `targetMonth` | required if `period=month` | format `YYYY-MM`                                                |
| `targetYear`  | required if `period=year`  | format `YYYY`                                                   |

Examples:

- `GET .../spending-summary?period=month&targetMonth=2026-07`
- `GET .../spending-summary?period=year&targetYear=2026`
- `GET .../spending-summary?period=lifetime`

Response is totals only (`totalSpending`, `categoryBreakdown` per maintenance type + a `Fuel` bucket) — averages are intentionally left for the frontend to compute.

---

## Fields you will never see accepted in any request body

| Module                   | Field                                    | Why                                                                                 |
| ------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------------- |
| user                     | `isDeleted`, `userRole`, `expoPushToken` | defaults, not part of register                                                      |
| bike                     | `owner`                                  | derived from the JWT                                                                |
| bike                     | `currentOdometer` (on `PATCH`)           | stripped server-side; only settable as the initial value on create                  |
| fuelLog                  | `totalCost`                              | always recomputed from `litersAdded * pricePerLiter`                                |
| fuelLog / maintenanceLog | `bike`                                   | comes from the URL's `:bikeId`, not the body                                        |
| maintenanceLog           | `nextDueOdometer`                        | always recomputed from `odometerReading + intervalKmUsed`                           |
| mileageRecord            | everything                               | no write endpoints exist — records are only created by closing a full-tank fuel log |
