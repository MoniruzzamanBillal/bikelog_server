# Bike Log API — Postman dummy data reference

Companion doc for `bikelog-api.postman_collection.json`. Every example body below matches what's already filled into the collection — this file exists so you can see the _why_ (required vs optional fields, what's rejected/ignored) without having to open each request in Postman.

## How to use

1. Import `bikelog-api.postman_collection.json` into Postman.
2. Check the collection variable `baseUrl` (collection → Variables tab) — defaults to `http://localhost:5000/api`. Change the port if your `.env`'s `PORT` isn't `5000`.
3. Run requests in this order the first time, top to bottom — each one's test script auto-captures an id into a collection variable that later requests depend on:
   1. **Auth → Register** (only once — a second run 409s since the email already exists)
   2. **Auth → Login** — captures `token` (access, 15 min) and `refreshToken` (15 days)
   3. **Bikes → Create Bike** — captures `bikeId`
   4. **Maintenance Types → Create Maintenance Type** — captures `maintenanceTypeId`
   5. **Engine Oil Types → Create Engine Oil Type** — captures `engineOilTypeId`
   6. **Fuel Logs → Create Fuel Log** — captures `fuelLogId`
   7. **Maintenance Logs → Create Maintenance Log** — captures `maintenanceLogId`
   8. **Engine Oil Logs → Create Engine Oil Log** — captures `engineOilLogId`
4. After that, every other request (list/get/update/delete, mileage, reminders, spending) works as-is. Re-run any `Create` request any time to refresh its captured id.
5. Auth is Bearer `{{token}}` at the collection level — you don't need to set headers manually on each request.
6. `Bikes → Delete Bike` soft-deletes the bike everything else chains off of — run it last, if at all.

There is no way to seed the two catalogs: the seed scripts were removed in spec 42, and spec 46 made both catalogs **per-user**, so a fresh account's `List Maintenance Types` / `List Engine Oil Types` legitimately returns `[]`. Create your own rows via the two `Create` requests — they auto-capture `{{maintenanceTypeId}}` / `{{engineOilTypeId}}` for you.

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

**Response shape is different from every other endpoint**: `{ success, message, data: null, token: "<jwt>", refreshToken: "<jwt>" }` — both JWTs are top-level fields, not under `data`. The collection's test script reads them from there.

Since spec 51 there are **two** tokens. `token` is the **access** token (15 minutes) and is what every authenticated request sends as `Authorization: Bearer`. `refreshToken` (15 days) is exchanged for a new access token at the route below; it is the only thing that keeps a session alive beyond 15 minutes. `token` kept its name and meaning on purpose, so clients written before spec 51 keep working unchanged.

### `POST /api/auth/refresh-token` — no auth

```json
{
  "refreshToken": "<the refreshToken from login>"
}
```

Returns `{ success, message, data: null, token: "<new 15-minute access token>" }`. The refresh token is **not** echoed back and **not** rotated — it stays valid until it expires, so the client has nothing to re-store.

`authCheck` is deliberately absent: the caller is here precisely because its access token expired, so requiring one would make the route unusable. The refresh token in the body is the credential.

Every failure — malformed, bad signature, expired, an **access** token presented here, unknown user, soft-deleted user — returns the same `401 "Invalid or expired refresh token"`, so the response cannot be used to probe which it was. A missing or non-string `refreshToken` is a `400` from `validateRequest` instead, never a `401`: the client must not log the user out over its own malformed request.

Two things worth knowing when testing it: a `401` from this route writes **no** `error_logs` row (the request body holds a live 15-day credential), and no token is stored server-side at all — so nothing here can revoke one, and logout is purely client-side.

### `GET /api/auth/me` — auth required

No body. Returns the logged-in user (password excluded). Since spec 53 the response also carries
`profilePicture` — either `{ url, publicId }` or `null` — and so do the `register`, `update-profile`,
`profile-picture` and `push-token` responses: they all share one `safeUserSelect`.

### `PATCH /api/auth/update-profile` — auth required

```json
{
  "name": "Moniruzzaman Billal"
}
```

| Field   | Required | Rules |
| ------- | -------- | ----- |
| `name`  | **yes**  | string, **trimmed**, 1–60 chars. Whitespace-only is a `400` — `trim()` runs before `min(1)` |
| `email` | —        | **refused.** Sending the key at all is a `400`: "Email can't be changed. It is the account's login identifier." (spec 55) |

`name` is the only editable user field besides the picture and the push token (spec 53). There is **no user
id in the path**: the route acts on the token's `userId`, so there is nothing to tamper with.

**Spec 55 made the email refusal explicit rather than silent.** Before it, a plain Zod object stripped the
extra key and the route answered `200 Profile updated successfully!!!` having changed nothing — which a
client cannot tell apart from success. Three reasons the email stays locked: it is the login identifier
(`loginFromDb` does `findUnique({ where: { email } })`), it is `@unique` so a collision is a hard failure,
and there is **no mail sender in this project**, so a change could be neither verified nor undone — one typo
and the account's own owner cannot sign in. Both clients render it as a read-only field. Two layers enforce
it: the schema's `email: z.undefined()` (which produces the message) and the service's literal
`data: { name }` (which makes it true). Changing a real user's address is a deliberate DB write, the same
documented convention as promoting an admin. Password is not editable anywhere on this API either — that
needs the current password and is its own future spec.

### `PUT /api/auth/profile-picture` — auth required

`multipart/form-data`, **one part named `image`**.

| Part    | Required | Rules |
| ------- | -------- | ----- |
| `image` | **yes**  | `image/*` only, **4 MB max** |

4 MB, not the 5 MB the other image routes allow: Vercel refuses a request body over ~4.5 MB before it
reaches multer, so a 5 MB cap would make the clean `400` unreachable in production. The asset is stored
under Cloudinary folder `bikelog/avatars`, transformed to 512×512 `crop: fill, gravity: face` — the app
does no client-side resize, so normalising happens server-side.

Four distinct `400`s, each from a different layer, which is worth knowing when a test fails:

| Cause | Where it comes from | Message |
| ----- | ------------------- | ------- |
| Part named anything but `image` | multer | `Unexpected field` |
| Over 4 MB | multer | `File too large` |
| Not an image | the `fileFilter` | `Only image files are allowed` |
| No file part at all | the service | `Image file is required` |

All four arrive as a clean `400` only because the route wraps the upload in `handleAvatarUpload` — a
`MulterError` is not an `AppError` and has no `.status`, so without it the first two would surface as a
`500`. Replacing an existing picture deletes the old Cloudinary asset **after** the DB write, so the row
never points at a deleted asset; the worst case is one orphaned asset.

### `DELETE /api/auth/profile-picture` — auth required

No body. Responds with the same user shape and `profilePicture: null`. Running it twice is a `404`
(`Profile picture not found`) — the column is cleared with `Prisma.JsonNull`, which reads back as JS
`null`, so the guard correctly sees it as absent. `PUT .../profile-picture` is **not** `PATCH
/auth/update-profile` with an extra field: an image is multipart and the name is Zod-validated JSON, and
keeping them separate is what lets the app upload a photo immediately while **Save** means the name only.

### `POST /api/auth/push-token` — auth required

```json
{
  "expoPushToken": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
}
```

Registers/updates this device's Expo push token on the logged-in user — called by the mobile app on login/app-launch (`bikelog_app`'s own spec 24), not something you'd normally call from Postman by hand. Feeds the weekly-summary cron job below.

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

**`purchaseDate` can't be in the future (spec 50).** More than a day ahead → `400` ("Purchase date can't be in the future"), on create and update. The one-day slack exists because `"YYYY-MM-DD"` parses as midnight UTC, so "today" for a user east of UTC can already be tomorrow in UTC. Any past date is accepted.

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
| `odometerReading`      | yes      | number, 0–999,999; must not go backwards in date order (see below) |
| `litersAdded`          | yes      | positive number                               |
| `isFullTank`           | yes      | boolean — drives mileage-record closing logic |
| `pricePerLiter`        | yes      | positive number                               |
| `fuelStation`, `notes` | no       | strings                                       |
| `date`                 | no       | defaults to now; use for back-logging — but never before the bike's own `purchaseDate` (see below) |

**`date` can't predate the bike's `purchaseDate`** — a fuel log dated earlier than the bike's own `purchaseDate` gets a `400` ("Fuel log date cannot be before the bike's purchase date (YYYY-MM-DD)"), on both create and update. A date exactly equal to `purchaseDate` is allowed (you can log fuel the day you bought the bike); omitting `date` (defaults to now) is always fine, since "now" is necessarily after purchase.

**`odometerReading` is validated (spec 48).** Negative, non-finite or > 999,999 → `400`. It must also be non-decreasing in *date* order across the bike's live fuel logs: not below the bike's `initialOdometer` or the latest earlier log, and not above the next later log (`400`, with the bounding reading in the message). Backdating between existing logs is fine. A full-tank fill exactly at the previous full-tank reading (0 km) is saved but closes no mileage record (`mileageRecordClosed: null`). The same check runs on `PATCH` when `odometerReading` or `date` changes.

**Never send `totalCost`** — the Zod schema technically accepts it, but the service always overwrites it with `litersAdded * pricePerLiter` server-side and discards whatever you send (this was a real bug fixed in a later audit — see `context/progress-tracker.md`'s "Recent Activity").

Response is `{ data: { fuelLog, mileageRecordClosed } }` — note the extra nesting under `fuelLog`, unlike every other create endpoint.

### `GET .../fuel-logs` — auth required

Query params (all optional): `page`, `limit` (pagination), `sort` (default `-date`), plus generic filter fields. `bike` and `isDeleted` query keys are explicitly ignored server-side — a fixed IDOR meant a client could once override the ownership filter through them; that's now blocked.

**Two derived fields per row, read-only (never send them) — spec 57.** `kmOnThisFill` is the **next** fill-up's odometer reading minus this row's, i.e. how far this tank actually carried the bike, and `costPerKm` is `totalCost / kmOnThisFill`. The newest fill-up has no following fill-up, so both are `null`; two fills at the same odometer reading give `costPerKm: null`, never `Infinity`. The server computes them because the neighbouring fill-up sits on the previous page at every page boundary, so `?page=2`'s first row still carries a real figure — check it with `?page=2&limit=1`. `GET .../fuel-logs/:id` carries **neither** key. This is **money per km, not mileage**: km/l comes from the closed full-tank periods under `/mileage`, and unlike those, `costPerKm` counts partial fills too.

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

## Maintenance Types (`/api/maintenance-types`) — per-user catalog, not per-bike

### `POST /api/maintenance-types` — auth required

```json
{
  "name": "Suspension Check",
  "defaultIntervalKm": 5000,
  "defaultIntervalDays": null,
  "requiresOilType": false
}
```

`name` required; `defaultIntervalKm`/`defaultIntervalDays` optional, positive numbers or `null`; `requiresOilType` optional boolean, defaults `false`.

`requiresOilType: true` is what makes both clients show the engine-oil dropdown on a maintenance log (spec 46 §G). It replaced the old client-side `name === "Engine Oil"` string match, which only worked because the global catalog happened to be seeded with that exact name. **`ownerId` is not accepted in the body** on create or update — it comes from the JWT.

**The 8 types specs 06/07 originally seeded**, kept here only as sensible example values to type in — nothing seeds them any more (spec 42 removed the scripts, and spec 46 made the catalog per-user, so a new account starts empty):
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

**Names (spec 50):** `name` is trimmed and can't be empty or whitespace (`400`, also on `PATCH`). A name that differs from one of your *live* types only by letter case (`engine oil change` vs `Engine Oil Change`) is a duplicate → `409`; renaming a type to a different casing of its own name is fine. Re-adding a name you deleted — in any casing — revives the deleted row (same `_id`, new casing). Other users' types are never compared.

### `GET /api/maintenance-types` — auth required

Lists the **authenticated user's own** live maintenance types, sorted by name (spec 46 — not scoped to a bike, but scoped to the rider). An empty array is correct for a new account. Another user's id on the `PATCH`/`DELETE` routes returns 404, never 403.

---

## Engine Oil Types (`/api/engine-oil-types`) — per-user catalog, not per-bike

### `POST /api/engine-oil-types` — auth required

```json
{
  "name": "Fully Synthetic 10W-40",
  "suggestedIntervalKm": 1200
}
```

Both fields required; `suggestedIntervalKm` positive.

**The 3 types spec 07 originally seeded**, kept as example values only — nothing seeds them any more, and this catalog is per-user as of spec 46:
| name | suggestedIntervalKm |
|---|---|
| Mineral | 800 |
| Semi-Synthetic | 1000 |
| Synthetic | 1250 |

**Names (spec 50):** same rules as maintenance types — trimmed, non-empty, case-insensitive duplicate → `409`, revive keeps the `_id`.

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

| Field                            | Required | Notes                                                    |
| --------------------------------- | -------- | -------------------------------------------------------- |
| `maintenanceType`                 | yes      | ObjectId ref to a `MaintenanceType` — must already exist |
| `odometerReading`, `cost`         | yes      | numbers (`cost` nonnegative)                             |
| `intervalKmUsed`                  | no       | number — the service interval actually applied; omit for a one-off item with no recurring interval |
| `oilType`                         | no       | ObjectId ref to an `EngineOilType` if provided           |
| `nextDueDate`, `serviceDate`      | no       | dates; `serviceDate` defaults to now                     |
| `serviceCenter`, `notes`          | no       | strings                                                  |
| `partsReplaced`                   | no       | array of strings                                         |

`maintenanceType`/`oilType` are real Mongo ObjectIds referencing other collections — they can't be made up. The Postman collection uses `{{maintenanceTypeId}}` / `{{engineOilTypeId}}`, auto-filled by the `Create Maintenance Type`/`Create Engine Oil Type` requests (or paste in a seeded catalog id from the `List` requests).

**Never send `nextDueOdometer`** — always computed server-side as `odometerReading + intervalKmUsed`; any client value is dropped. When `intervalKmUsed` is omitted, `nextDueOdometer` is left unset too (no default interval is assumed), and `GET .../reminders` falls back to that log's `nextDueDate` alone — a log with neither `intervalKmUsed` nor `nextDueDate` set never produces a reminder.

**Sanity checks (spec 50).** `serviceDate` before the bike's `purchaseDate` → `400` ("Maintenance date cannot be before the bike's purchase date (YYYY-MM-DD)"), on create and `PATCH`; equal to the purchase date, or omitted (defaults to now), is fine. `odometerReading` must be a finite number 0–999,999 (`400` otherwise, create and `PATCH`).

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

## Engine Oil Logs (`/api/bikes/:bikeId/engine-oil-logs`)

Spec 54. An oil change is its own record now, not a maintenance log with an oil type bolted on. The historical entries were carried over by `src/scripts/importOilMaintenanceLogsToEngineOilLogs.ts`, which copies them and then soft-deletes the originals — so an imported row has `importedFromMaintenanceLogId` set and the maintenance log it came from no longer appears in the Maintenance Logs list.

### `GET .../engine-oil-logs/status` — auth required

No body, no query params. The whole oil screen in one request, computed on read — **nothing is stored**. `bike.currentOdometer` is read live on every call, which is what makes a Settings odometer update (`PATCH /api/bikes/:id/odometer`) show up here immediately.

| Field                                | Always? | Notes                                                                                          |
| ------------------------------------ | ------- | ---------------------------------------------------------------------------------------------- |
| `status`                             | yes     | `"ok"` / `"upcoming"` / `"overdue"` / `"unknown"`                                             |
| `currentOdometer`                    | yes     | the bike's live reading                                                                        |
| `lastChange`                         | yes     | `null` when there is no oil log yet; otherwise `{ _id, changeDate, odometerReading, oilType, intervalKm?, nextDueOdometer?, oilFilterChanged }` |
| `kmSinceChange`                      | no      | absent only in the no-log state; floored at 0                                                 |
| `kmRemaining`                        | no      | **signed** — negative means past due. Absent when the log carries no interval                 |
| `percentUsed`                        | no      | integer percent; absent with `kmRemaining`                                                     |
| `projectedDaysRemaining`             | no      | absent when there is no rate at all, and **always absent when overdue** (it would have to go negative) |
| `projectedDueDate`                   | no      | absent only when there is no rate at all. Since spec 56 it is also sent when **overdue**, where it is in the **past** — the day the oil is estimated to have hit its due point |
| `overdueDays`                        | no      | spec 56; positive, only with `status: "overdue"` and a usable rate                             |
| `kmPerDay`, `rateBasis`              | no      | present whenever any rate exists (1dp). `rateBasis` is `{ spanDays, distanceKm, source? }`, where `source` is `"recent"` \| `"history"` \| `"lifetime"` (spec 56) |
| `estimate`                           | no      | spec 56; present only when `lastChange.intervalKm` is absent **and** the log resolves an oil type. `{ basis: "oilTypeSuggestion", status, intervalKm, nextDueOdometer, kmRemaining, percentUsed, projectedDaysRemaining?, projectedDueDate?, overdueDays? }` |

Three non-error states, each with a defined shape rather than a `null` to guess at:

- **No oil log yet** → `status: "unknown"`, `lastChange: null`, `currentOdometer` only.
- **An imported log with no interval** → `lastChange` + `kmSinceChange` present, everything interval-derived omitted, `status: "unknown"` — but since spec 56 an `estimate` object usually comes with it, derived from the oil type's current `suggestedIntervalKm`.
- **No usable riding rate** (fewer than 2 fuel logs in the last 28 days, a span under 14 days, or under 100 km covered) → `status` still falls back to the pre-spec-52 "within 50 km" rule, but since spec 56 the **date** no longer disappears: a looser fallback rate (the bike's whole fuel history, else its lifetime odometer average) is used for the projection alone, tagged in `rateBasis.source`. The fallback never feeds the due evaluation, so no `status` value and no reminder threshold moves because of it.

**Everything under `estimate` is provisional** — it is derived from the catalog's *current* suggestion, so editing the oil type moves it. A client must label it as an estimate; set a real interval on the change to make it exact.

### `POST .../engine-oil-logs` — auth required

```json
{
  "oilType": "<a real EngineOilType _id>",
  "odometerReading": 18400,
  "intervalKmUsed": 2400,
  "quantityLiters": 1.2,
  "oilFilterChanged": true,
  "cost": 1250,
  "changeDate": "2026-08-12",
  "serviceCenter": "City Bike Care",
  "notes": "Motul 7100, filter changed too"
}
```

| Field                       | Required | Notes                                                                                              |
| --------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `oilType`                   | yes      | ObjectId ref to one of **your own** `EngineOilType` rows — another user's id is a 404, not a 403   |
| `odometerReading`           | yes      | finite number 0–999,999                                                                            |
| `cost`                      | yes      | finite, nonnegative, ≤ 9,999,999.99                                                                |
| `intervalKmUsed`            | no       | positive, ≤ 100,000. The client normally sends it, pre-filled from the oil type's `suggestedIntervalKm` and editable by the rider; omitted, the server falls back to that same catalog value |
| `quantityLiters`            | no       | positive, ≤ 20                                                                                     |
| `oilFilterChanged`          | no       | boolean, defaults `false`                                                                          |
| `changeDate`                | no       | date; defaults to now                                                                              |
| `serviceCenter`             | no       | string, ≤ 100 chars                                                                                |
| `notes`                     | no       | string, ≤ 500 chars                                                                                |

**Never send `nextDueOdometer`** — always server-derived as `odometerReading + intervalKmUsed`, and absent from both the create and the update schema. Whatever interval is resolved at write time is **frozen on the row**: editing the oil type's `suggestedIntervalKm` later never moves a past change's due point, and only the next log entered picks up the new suggestion.

**Odometer ordering.** The reading must be ≥ the newest earlier oil log's and ≤ the oldest later one's, across this bike's live oil logs (400 otherwise, naming the offending reading). It is **not** compared against `currentOdometer`, so backdating the oil change you already made — the first thing you will do on this screen — works.

**Sanity checks.** `changeDate` before the bike's `purchaseDate` → 400 ("Engine oil change date cannot be before the bike's purchase date (YYYY-MM-DD)"), on create and `PATCH`; equal, or omitted, is fine.

### `GET .../engine-oil-logs` — auth required

Same query support as fuel logs: `page`, `limit`, `sort` (default `-changeDate`, with `createdAt desc` appended so two changes entered on the same calendar day have a total order). `bike`/`isDeleted` query keys are ignored server-side for the same IDOR-hardening reason as fuel logs. Don't invent other filters — leftover query params land in the Prisma `where` with no coercion and a non-string value 500s.

**Two derived fields per row, read-only (never send them).** `kmOnThisOil` is the **next** change's odometer minus this row's — how far this oil actually ran — and `costPerKm` is `cost / kmOnThisOil`. The newest change has no following change, so both are `null`; two changes at the same odometer give `costPerKm: null`, never `Infinity`. The server computes them because the neighbouring change sits on the previous page at every page boundary, so `?page=2`'s first row still carries a real figure. `GET .../engine-oil-logs/:id` returns both as `null` — the key is always present, the lookup just isn't run.

### `GET .../engine-oil-logs/:id`, `PATCH .../engine-oil-logs/:id`, `DELETE .../engine-oil-logs/:id` — auth required

Update body: same fields as create, all optional. `oilType` may be re-pointed but never cleared. There is **no** closed-period lock here, unlike fuel logs — nothing downstream closes over an oil log, so an oil log is always editable and `DELETE` is a plain soft delete.

`nextDueOdometer` is recomputed when `odometerReading` or `intervalKmUsed` moves, and **only** then: a `PATCH` that changes `oilType` alone leaves the stored interval and the due point untouched.

```json
{
  "cost": 1300,
  "notes": "Corrected cost after receipt"
}
```

### Reminders and spending both still see oil changes

- `GET /api/bikes/:bikeId/reminders` keeps emitting an engine-oil reminder, now sourced from this table instead of `maintenance_logs` — same shape, same fields, so both clients' existing banners render it with no change.
- Oil money appears in `GET .../spending-summary` as its own `Engine Oil` category, and in `.../spending-summary/details` as a `source: "oil"` record.

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

Response is totals only (`totalSpending`, `categoryBreakdown` per maintenance type + a `Fuel` bucket + an `Accessories` bucket + an `Engine Oil` bucket since spec 54) — averages are intentionally left for the frontend to compute.

**Accessories count too (spec 25)**: a `bikeAccessory` only contributes to spending once its `status` is `"purchased"` — `pending`/`cancelled` wishlist entries never appear here. It's bucketed by `purchaseDate` (server-stamped the moment `status` became `"purchased"`, not `createdAt`), so it lands in whichever month/year it was actually marked purchased. `GET .../spending-summary/details` (spec 23's line-item export endpoint, undocumented elsewhere in this file — a pre-existing gap) includes it as its own `source: "accessory"` record, alongside `"fuel"`, `"maintenance"` and — since spec 54 — `"oil"`.

---

## Image uploads (Cloudinary) — fuel logs, maintenance logs, engine oil logs, accessories, issues

Five modules support attaching a Cloudinary-backed image; all upload/replace requests are `multipart/form-data`, not JSON, and all image fields are optional (older records simply have none).

| Route                                                              | Field name(s)     | Cardinality              |
| ------------------------------------------------------------------- | ------------------ | ------------------------- |
| `PUT/DELETE .../fuel-logs/:id/image`                                | `receiptImage`      | one per fuel log          |
| `PUT/DELETE .../maintenance-logs/:id/image`                         | `serviceImage`      | one per maintenance log   |
| `PUT/DELETE .../engine-oil-logs/:id/image`                          | `receiptImage`      | one per engine oil log    |
| `PUT/DELETE .../accessories/:id/image`                              | `productImage`      | one per accessory         |
| `POST .../issues/:id/images`, `DELETE .../issues/:id/images/:imageId` | `images` (array)  | many per issue (up to 5 per POST request) |

Notes:

- Upload form field is `image` (singular endpoints) or `images` (bike issue's multi-image endpoint — repeat the form key once per file, up to 5 per request).
- Only image mimetypes are accepted (5MB max per file) — anything else 400s before reaching Cloudinary.
- Every stored image is `{ url, publicId }`, never a bare string — `publicId` is what lets the server actually delete the old Cloudinary asset when you replace or remove an image, instead of leaving it orphaned.
- Replacing a single-image field (`PUT .../image`) deletes the old Cloudinary asset first, then uploads the new one.
- **Imported engine oil logs share their asset with the maintenance log they came from** until the import's `--finalize` step soft-deletes that log: the import copies the `{ url, publicId }` reference, never the file. Deleting the image on such a row before finalize would break the maintenance log's thumbnail too.
- Bike issue images are additive (`POST` appends, never replaces) — each image gets its own subdocument `_id`, used to delete just that one image via `DELETE .../images/:imageId`.
- `bikeAccessoryId` **is** auto-captured now (spec 25 added a `Create Bike Accessory` request to the collection, closing this gap). `bikeIssueId` still isn't (no `Create`/`List` request exists for that module in this collection yet) — paste in a real id from that bike's `/issues` endpoint manually.

## Bike Accessories (`/api/bikes/:bikeId/accessories`) — per-bike purchase wishlist

`name`/`urgency` required on create; `status` defaults to `"pending"`. Three status values: `pending`, `purchased`, `cancelled`.

**The purchase lock (spec 25)**: once `status` is `"purchased"`, it can never change to anything else — a `PATCH` attempting to change it away from `"purchased"` gets a `400`. Every other field (`name`, `urgency`, `price`, `productImage`) stays freely editable on the same accessory after that point.

**`price` is required the moment `status` becomes `"purchased"`** — whether that's on `POST` (creating directly as purchased) or `PATCH` (transitioning an existing `pending`/`cancelled` entry) — a `400` otherwise. `price` stays optional for `pending`/`cancelled` entries.

**`purchaseDate` is entirely server-computed** — never send it, it isn't part of the request schema at all. The server stamps it to the current date the instant `status` actually transitions into `"purchased"`, and (since the lock above guarantees that only happens once) it's never touched again by a later edit.

```json
// POST — create directly as purchased
{
  "name": "Crash Guard (Bumper)",
  "urgency": "medium",
  "status": "purchased",
  "price": 1290
}
```

```json
// PATCH — lock violation, 400
{
  "status": "pending"
}
```

`GET /` list ordering is a real quirk (spec 13): it runs one query per status (`pending → purchased → cancelled` order, or just the single requested status if `?status=` is given) and concatenates the results — a grouped feed, not one flat chronologically-sorted list.

## Bike Manual (`/api/bikes/:bikeId/manual`) — one PDF per bike, grounds AI chat

`POST .../manual` is `multipart/form-data`, field name `manual`, PDF only (20MB max, vs. the 5MB image limit above) — anything else 400s before reaching Cloudinary. Upload-or-replace semantics: re-`POST`ing to the same bike deletes the old raw Cloudinary asset + regenerated text chunks first, then uploads/chunks the new PDF. `GET` returns metadata only (`hasManual`, `manual: {url, publicId, originalName, uploadedAt, chunkCount}` or `null`) — it's `200` with `hasManual: false` when nothing's been uploaded yet, not a `404`. `DELETE` 404s if the bike has no manual.

Once a manual is uploaded, `POST /api/bikes/:bikeId/ai/chat` automatically pulls the most relevant excerpt(s) into its system prompt via in-process keyword scoring (no separate "search the manual" endpoint to call) — ask something the manual actually covers (e.g. a service interval) to see it grounded in the real text instead of a generic answer.

## Bike Documents (`/api/bikes/:bikeId/documents`) — papers/IDs with expiry tracking, mixed image+PDF files

Two-step create-then-attach, same pattern as bike issues: `POST .../documents` is plain JSON (`{ title, description?, expiryDate? }`, no file field), then files are attached separately via a dedicated sub-route.

| Route                                                              | Field name | Cardinality                     |
| ------------------------------------------------------------------- | ---------- | -------------------------------- |
| `POST .../documents/:id/files`, `DELETE .../documents/:id/files/:fileId` | `files` (array) | many per document (up to 10 per POST request) |

Notes:

- `title` is required and free-text (e.g. "Bike Registration Paper", "Bank Receipt", "Driving License") — there's no fixed category enum, matching how the feature was actually asked for.
- `expiryDate` is optional and unconstrained (a past date is accepted, for backfilling an already-expired paper).
- Attach form field is `files` — repeat the key once per file, up to 10 per request. Unlike every other upload feature in this collection, **both images and PDFs are accepted in the same field** (20MB max per file, vs. the 5MB image-only limit elsewhere).
- Every stored file is `{ url, publicId, resourceType, originalName, mimeType }` — `resourceType` (`"image"` or `"raw"`) is new compared to the other upload features' plain `{url, publicId}` and is what lets the server delete a PDF asset correctly (Cloudinary requires the right resource type on destroy).
- Files are additive (`POST` appends, never replaces) — each file gets its own subdocument `_id`, used to delete just that one file via `DELETE .../files/:fileId`.
- `GET .../documents` defaults to soonest-expiry-first ordering (documents with no `expiryDate` sort last); pass `?sort=` to override with a plain field sort instead.
- `bikeDocumentId`/`bikeDocumentFileId` **are** auto-captured by this collection's `Create Bike Document`/`Add Bike Document Files` requests, same as `bikeAccessoryId` now (spec 25) — `bikeIssueId` is still the one remaining gap, noted above.

## Cron / Notifications (`/api/cron`)

### `POST /api/cron/weekly-summary` — **not** JWT-authed, secret header instead

No body. Requires an `x-cron-secret` header matching the server's `CRON_SECRET` env var (set the collection's `cronSecret` variable to the same value before running this manually) — a `401` with no header or the wrong value, same as a bad JWT would 401 elsewhere.

For every user with a registered `expoPushToken`, computes each of their bikes' current **Friday–Thursday** week (not the calendar week) — the week about to finish that same night, since the scheduled job fires **Thursday 10pm Asia/Dhaka** — and sends one Expo push notification per bike that had at least one fuel log that week, skipped silently (not an error) for a bike with zero fuel logs in that window. Meant to be hit once a week by a scheduled job (`.github/workflows/weekly-summary-cron.yml`), not by the app. Returns `{usersProcessed, bikesSkipped, notificationsSent, notificationsFailed}` so the calling job's own logs show what happened.

## Error Logs (`/api/admin/error-logs`) — admin-only, read-only

Every error that reaches `globalErrorHandler` (an `AppError`, a Zod validation failure, a Mongoose `CastError`/`ValidationError`, a Mongo duplicate-key conflict, or any unclassified thrown error) is automatically persisted here first, before the error response is sent — nothing needs to call this module directly. There is no create/update/delete endpoint; entries expire automatically 30 days after they were created via a MongoDB TTL index, so there's nothing to clean up manually either.

Both routes require a JWT belonging to a user whose `userRole` is `"admin"` — every account registers as `"user"` by default, and there is currently no promotion endpoint, so the first admin account has to be created with a direct database write (e.g. `db.users.updateOne({email: "..."}, {$set: {userRole: "admin"}})`). **Important**: `userRole` is baked into the JWT at login time, so promoting an account only takes effect the *next* time that account logs in — an already-issued token keeps acting as `"user"` until it's refreshed. A non-admin (or unauthenticated) request gets `401`/`403`, not the log data.

### `GET /api/admin/error-logs` — paginated list, newest-first by default

Same `{result, meta}` shape as every other paginated list endpoint (`fuelLog`, `maintenanceLog`, `bikeIssue`, `bikeAccessory`). Optional query params: `page`, `limit`, `sort`, and exact-match filters `status` (e.g. `?status=500`) and `method` (e.g. `?method=POST`). Each entry includes `status`, `message`, `errorName`, `errorSources`, `stack`, `method`, `path`, `userId`/`userEmail` (both `null` when the failing request wasn't authenticated), and `createdAt`.

### `GET /api/admin/error-logs/:id` — single entry, full detail

Returns one log document in full, including the complete `stack` trace. A nonexistent id — or one that's already aged out past the 30-day TTL window — returns `404`, the same as a never-existed id.

## Fields you will never see accepted in any request body

| Module                   | Field                                    | Why                                                                                 |
| ------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------------- |
| user                     | `isDeleted`, `userRole`                  | defaults, not part of register                                                      |
| user                     | `expoPushToken` (on register/any other endpoint) | defaults to `null`; only ever set via the dedicated `POST /api/auth/push-token` above |
| bike                     | `owner`                                  | derived from the JWT                                                                |
| bike                     | `currentOdometer` (on `PATCH`)           | stripped server-side; only settable as the initial value on create                  |
| fuelLog                  | `totalCost`                              | always recomputed from `litersAdded * pricePerLiter`                                |
| fuelLog / maintenanceLog / engineOilLog / bikeDocument | `bike`      | comes from the URL's `:bikeId`, not the body                                        |
| maintenanceLog / engineOilLog | `nextDueOdometer`                   | always recomputed from `odometerReading + intervalKmUsed`                           |
| engineOilLog             | `importedFromMaintenanceLogId`           | written only by the spec 54 import script, never over the wire                      |
| mileageRecord            | everything                               | no write endpoints exist — records are only created by closing a full-tank fuel log |
