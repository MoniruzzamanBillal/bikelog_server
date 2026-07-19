# Bike Log — Project Plan (Idea, SRS-lite, Schema)

## Context

You just bought your first bike. It has no built-in average-mileage computer, so you can't tell how many km/l you're getting, and you're tracking engine-oil changes manually via the break-in schedule your brother gave you (change oil every 300km until the odometer hits 2000km). You also want to track every taka spent on the bike — fuel, oil, servicing, parts — in one place.

You work as a MERN dev at ATI Limited and normally build backends with NestJS, but since Nest isn't free to deploy, this project will use **Express + MongoDB/Mongoose**, deployable free on Vercel. You already have reference backends (`lms_server`, `expense-tracker-server`) built this way — this plan reuses their exact conventions (module-per-feature folders, Zod validation, JWT auth, `AppError`/`catchAsync`/`sendResponse` helpers, camelCase Mongoose schemas with `timestamps` and `isDeleted` soft delete) so the eventual build will feel like an extension of code you already know, not a new pattern to learn.

For the frontend, you plan **React Native**, plus a fully mobile-responsive web version — and everything should stay on free services. Section 7 covers the recommended frontend stack and how reminders/notifications work on React Native.

This document covers **idea → requirements → data model → core logic → API surface**. No backend code is written yet, per your instruction.

---

## 1. Project Idea

**Bike Log** — a personal (multi-user capable) app to log every fuel fill-up and maintenance event for your motorcycle(s), and automatically derive:

- **Real average mileage (km/l)**, computed correctly even though you don't always fill the tank fully.
- **Km-based maintenance reminders** (engine oil, and anything else), based on your odometer — not on trip meters, which are easy to forget to reset.
- **Total spending**, broken down by category (fuel vs. maintenance vs. parts) and by time period.

Multiple bikes per user are supported from day one (cheap to model, and useful if you ever get a second bike or track a friend's).

---

## 2. The problems you flagged, solved

### 2.1 "How do I track mileage with Trip A when I don't always fill the tank full?"

Trip A is unreliable for this because it depends on you remembering to reset it, and partial fills break simple "distance ÷ liters" math. Instead, the app uses the **odometer** as the source of truth (it's monotonic, you never reset it) plus the standard **full-tank-to-full-tank method** used by fuel-tracking apps:

- Every time you fill up, log: odometer reading, liters added, cost, and whether it was a **full tank** (topped off) or a **partial fill**.
- The app keeps a running "open period": starting odometer (from the last full tank) and cumulative liters added since then.
- **Partial fill** → just adds its liters to the running total. No mileage is computed yet (correct — you can't know mileage mid-tank).
- **Full fill** → this closes the period. The app computes:
  ```
  distance = currentOdometer - periodStartOdometer
  totalLiters = sum(all liters added since periodStartOdometer, including this fill)
  mileage (km/l) = distance / totalLiters
  ```
  It then starts a new period from this odometer reading.

This is exact regardless of how many partial fills happened in between — you only ever need to answer "did I top it off or not?" at each fill, nothing else. Trip A on the bike becomes optional/cosmetic; you can still log it for your own sanity-check but the app won't depend on it.

You've confirmed you'll start using the app the same way regardless: top off the tank fully on day one (you already have 10L+ in it, so you'll add fuel to fill it before your first log entry), which immediately establishes a clean, exact anchor point — so the full-tank method above is your real starting condition, not just a theoretical best case.

**But what if a later fill-up isn't topped off** — e.g. sometimes you only add a partial amount? Then that entry alone can't close a period (correctly — you can't know mileage mid-tank), but it doesn't break anything: it just accumulates into the running total until the _next_ full fill closes the period, however many partial fills happened in between. And if you ever go through a longer stretch of only partial fills (never fully topping off for a while), the fallback below still gives you a usable number:

- **Recommended — occasional calibration fill.** You don't have to change your habit every time; just top off fully every so often (say, once every 5–10 fills, whenever it's convenient). Every full fill closes an exact period using the method above. Between calibration fills, ordinary partial fills just keep accumulating liters as normal — nothing else about your routine changes.
- **Fallback — rolling-average mileage, if you genuinely never top off.** Compute `mileage ≈ total distance ÷ total liters added` over a trailing window (e.g. the last 10 fills, or last 30 days), _not_ tied to any full-tank closure. This isn't exact for any single tank — the leftover fuel at the start and end of the window is unknown — but if your refill habit is consistent (you always trigger a refill around the same tank level), that error is roughly the same at both ends of the window and mostly cancels out over many fills, converging toward the true average the longer the window gets. The app should label this figure "approximate" wherever it's shown, to distinguish it from the exact per-tank number produced above.

So `GET /api/bikes/:bikeId/mileage` returns both: any **exact** `MileageRecord`s produced by full-tank closures (if/when you do them), plus one **approximate rolling-average** number computed live from the trailing N `FuelLog`s regardless of fill type — so you always see _some_ mileage figure even if you never top off, but the app is honest about which numbers are exact vs. estimated.

### 2.2 "How do I track engine oil — the interval isn't fixed, it changes with break-in _and_ with oil type?"

Your actual schedule: 6 oil changes total during the first ~2000km break-in period (so intervals aren't even a flat 300km each — they vary), then after break-in the interval depends on which oil you switch to (e.g. synthetic ≈ 1200–1300km, mineral typically shorter). So the schema can't hardcode any single number — it needs to let **you** set the interval at the moment you log each change, informed by (but not locked to) the oil type used:

- Same principle as fuel: use the **odometer**, not Trip B, so a forgotten trip-meter reset never corrupts the schedule.
- `MaintenanceLog` (for Engine Oil specifically) stores `oilType` (e.g. "Mineral", "Semi-Synthetic", "Synthetic") alongside `intervalKmUsed` — the interval you're actually applying for _this_ change.
- A small reference table, `EngineOilType` (`name`, `suggestedIntervalKm`), holds your own running suggestions per oil brand/type (e.g. Synthetic → 1250km) purely as a **default to pre-fill the form** — you can always override `intervalKmUsed` per log, which is exactly what break-in requires (6 changes in ~2000km, each interval decided at the time, not a fixed 300).
- `nextDueOdometer = odometerReading + intervalKmUsed` is computed per log from whatever you entered, so it naturally adapts as you move from break-in → mineral/semi-synthetic → synthetic, with zero special-casing of "break-in mode" in the schema.
- A reminder is "due" when `currentOdometer >= nextDueOdometer`, and "upcoming" when within a configurable buffer (e.g. 50km away).

### 2.3 Monthly average & total (lifetime) average mileage — mirroring your `expense-tracker-server`/`expense-tracker-client` patterns

You asked for the same shape of stats you already have in your expense tracker: monthly figures, and a running total/history since day one. Rather than inventing a new mechanism, this reuses the **same "approximate rolling-average" formula from §2.1**, just applied to different date/odometer windows — and reuses the exact aggregation _style_ already in `expense-tracker-server/src/app/modules/transaction/transaction.service.ts`: plain Mongoose `.find()` over a date range + JS-side `filter()`/`reduce()`, **not** a Mongo `$group` aggregation pipeline. That file computes `getMonthlyTransactions`, `getWeeklySummary`, and `getYearlySummary` this way, and averages (e.g. `WeeklyAverageCard`'s `averageExpense = totalExpense / daysWithExpense`) are computed **client-side** by dividing two totals the API already returned — the mileage endpoints follow the identical division-happens-on-the-client convention:

- `GET /api/bikes/:bikeId/mileage/monthly?targetMonth=YYYY-MM` → `{ targetMonth, totalDistanceKm, totalLitersConsumed, fuelLogs }`, computed by fetching that month's `FuelLog`s (date range via `new Date(year, month-1, 1)` / `new Date(year, month, 0, 23,59,59,999)`, same as `getMonthlyTransactions`) and taking `distance = lastOdometerInMonth - firstOdometerBeforeMonth`, `liters = sum(litersAdded in month)`. The client computes `averageMileage = totalDistanceKm / totalLitersConsumed`, exactly like the weekly-average card does today.
- `GET /api/bikes/:bikeId/mileage/yearly?targetYear=YYYY` → `{ targetYear, monthlySummary: [{ month, totalDistanceKm, totalLitersConsumed, fuelLogCount }] }`, one entry per calendar month — a direct structural mirror of `getYearlySummary`'s `yearSummary` array, and the data source for a "Mileage History" screen built the same way as your existing `HistoryPage.tsx` (year selector + one card per month).
- `GET /api/bikes/:bikeId/mileage/lifetime` → `{ totalDistanceKm, totalLitersConsumed, fuelLogCount }` from bike-purchase odometer to now — this answers "total average mileage from the start to the current date," structurally mirroring your `TotalBalanceCard`'s all-time total.

This keeps the whole app's stats layer consistent: fuel/mileage stats and the spending-summary endpoint (§4) both follow the same JS-filter-reduce style already established in your expense tracker, instead of introducing a second aggregation approach.

---

## 3. Feature Scope

**MVP (build first):**

- Auth (register/login, JWT) — multi-user
- Bike CRUD (a user can own multiple bikes)
- Fuel log entries + automatic mileage computation (2.1)
- Maintenance log entries (starting with Engine Oil) + due/overdue reminders (2.2)
- Monthly/yearly/lifetime mileage stats (2.3)
- Spending summary (total, by category, by month)

**Phase 2 (once MVP works):**

- General maintenance & parts catalog (tire change, chain/sprocket, brake pads, general service, insurance/registration renewal, accessories/other)
- Push notifications for reminders (Vercel Cron + Expo push)
- Charts: mileage trend over time, spend trend over time

---

## 4. Data Model (Mongoose, camelCase, matching `lms_server`/`expense-tracker-server` conventions)

All schemas: `{ timestamps: true }`, soft delete via `isDeleted: boolean` + `pre("find")`/`pre("findOne")` filters, refs via `Schema.Types.ObjectId`, enums as `as const` objects + `T`-prefixed type aliases (not TS `enum`), Zod schemas per module for request validation.

**Event date vs. record-creation timestamp — important distinction.** You log entries after the fact sometimes (forget same-day), so every loggable entry (`FuelLog.date`, `MaintenanceLog.serviceDate`) is a **user-editable "when this happened" field**, defaulted to today in the frontend form but changeable to a past date. This is deliberately separate from Mongoose's own `createdAt` (when the record was saved to the DB) — and it's `date`/`serviceDate`, not `createdAt`, that all monthly/yearly/lifetime aggregations (§2.3) filter and bucket by. This is a small but deliberate deviation from `expense-tracker-server`'s `transaction.service.ts` (which buckets by `createdAt`) — necessary here specifically because you back-log entries, so a fill-up from 3 days ago must land in the correct month even if you enter it today.

**User**

- `name`, `email` (unique), `password` (hashed, bcrypt `pre("save")`), `expoPushToken` (nullable, Phase 2 — see §7.2), `isDeleted`

**Bike** (owner: User)

- `owner` (ref User), `nickname`, `brand`, `model`, `registrationNumber`, `purchaseDate`
- `fuelTankCapacityLiters`
- `currentOdometer` (denormalized — updated every time a fuel/maintenance log is created with a higher reading; this is what reminders and mileage math read from)

**FuelLog** (bike: Bike)

- `bike` (ref), `odometerReading`, `litersAdded`, `isFullTank` (boolean), `pricePerLiter`, `totalCost`, `fuelStation` (optional), `date`, `notes` (optional)

**MileageRecord** (auto-created — one per closed full-tank period; bike: Bike)

- `bike` (ref), `startOdometer`, `endOdometer`, `distanceKm`, `litersConsumed`, `mileageKmPerLiter`, `periodStartDate`, `periodEndDate`, `fuelLogIds` (refs of the FuelLogs that fed this period)

**MaintenanceType** (small seeded catalog, global or per-user)

- `name` (e.g. "Engine Oil", "Chain Lube", "Tire Change", "Brake Pads", "General Service", "Insurance", "Registration/Tax", "Other")
- `defaultIntervalKm` (nullable — just a form pre-fill default), `defaultIntervalDays` (nullable — for time-based items like insurance)

**EngineOilType** (small reference table, only used to pre-fill the Engine Oil form)

- `name` (e.g. "Mineral", "Semi-Synthetic", "Synthetic"), `suggestedIntervalKm`

**MaintenanceLog** (bike: Bike, type: MaintenanceType)

- `bike` (ref), `maintenanceType` (ref), `odometerReading`, `oilType` (ref `EngineOilType`, optional — only set when `maintenanceType` is Engine Oil), `intervalKmUsed` (the actual interval you applied for _this_ service — always user-editable, so break-in changes, oil-type changes, and normal intervals all just fall out of what you enter), `nextDueOdometer` (computed = `odometerReading + intervalKmUsed`), `nextDueDate` (optional, for time-based types), `cost`, `serviceDate`, `serviceCenter` (optional), `partsReplaced` (optional string array), `notes`

**Spending** is not a separate collection — it's derived by aggregating `FuelLog.totalCost` + `MaintenanceLog.cost` per bike, grouped by month/category, via the JS filter-reduce aggregation style described in §2.3.

---

## 5. API Surface (Express, `/api` prefix, matching lms_server's controller → service → `sendResponse` pattern)

- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `GET/POST/PATCH/DELETE /api/bikes` (+ `/api/bikes/:id`)
- `POST /api/bikes/:bikeId/fuel-logs`, `GET /api/bikes/:bikeId/fuel-logs`
- `GET /api/bikes/:bikeId/mileage` — returns exact `MileageRecord` history (from full-tank closures) _and_ a live approximate rolling-average figure computed from the trailing N `FuelLog`s (§2.1), clearly labeled as estimated
- `GET /api/bikes/:bikeId/mileage/monthly?targetMonth=` — totals for one month, client computes the average (§2.3)
- `GET /api/bikes/:bikeId/mileage/yearly?targetYear=` — per-month totals for a year, feeds the "Mileage History" screen (§2.3)
- `GET /api/bikes/:bikeId/mileage/lifetime` — all-time totals since bike purchase, feeds a "total average mileage" card (§2.3)
- `GET /api/maintenance-types`, `POST /api/maintenance-types` (custom types)
- `POST /api/bikes/:bikeId/maintenance-logs`, `GET /api/bikes/:bikeId/maintenance-logs`
- `GET /api/bikes/:bikeId/reminders` — upcoming/due/overdue maintenance, computed on read from `currentOdometer` vs each type's last log
- `GET /api/bikes/:bikeId/spending-summary?period=month|year` — total + category breakdown
- `POST /api/users/push-token` — Phase 2, stores the device's Expo push token on the User (§7.2)
- `POST /api/cron/check-reminders` — Phase 2, hit by a scheduled job, not by the app (§7.2)

---

## 6. Deployment Note (Vercel + Express)

Since this deploys as Vercel serverless functions, two things matter later at build time (no action now):

- Reuse the MongoDB connection across invocations (cache the Mongoose connection at module scope) — a fresh connection per request will exhaust connection limits fast.
- Reminders are computed **on read** (not via a background cron), since serverless functions don't keep a persistent process running. If you later want push/email alerts, Vercel Cron Jobs can hit a `/api/cron/check-reminders` route on a schedule — that's a Phase 2+ idea, not needed for MVP.

---

## 7. Frontend & Notifications (React Native + responsive web, all free)

### 7.1 Stack recommendation

Use **Expo (managed React Native)** + **React Native Web** as one codebase targeting iOS, Android, and a mobile-responsive web build — instead of hand-building two separate frontends. This keeps you on a single free toolchain:

- `npx create-expo-app`, run on your phone via **Expo Go** during development (free, no native build needed to test).
- `expo export --platform web` (or `expo start --web`) produces the responsive web version from the exact same components/screens — no second codebase to maintain.
- Hosting the web build: Vercel free tier (static export) — same account you're already using for the API.
- The one cost that isn't avoidable: publishing to the **Apple App Store** requires a $99/yr Apple Developer account. Everything else (Android, web, all development/testing via Expo Go) stays free. If you only ever sideload/test, you can skip that entirely.

### 7.2 Reminders/notifications on React Native — two tiers

Your reminders are all _data-driven_ (odometer crosses a threshold), not location/time-driven, so you don't need real-time push infra for the MVP:

**Tier 1 — in-app reminder (MVP, no extra infra):** every time the app opens or the user pulls to refresh, call the already-planned `GET /api/bikes/:bikeId/reminders` and render a banner/badge for anything due or upcoming (e.g. "Engine oil due in 40km"). Zero new moving parts — this alone solves "how do I not forget," as long as you open the app periodically.

**Tier 2 — actual OS push notification (Phase 2, so you get pinged even without opening the app):**

1. In the Expo app, use `expo-notifications` to request permission and obtain an **Expo push token** for the device.
2. `POST /api/users/push-token` sends that token to your backend, stored as `User.expoPushToken`.
3. A **Vercel Cron Job** (free on the Hobby plan — daily granularity is enough here) hits `POST /api/cron/check-reminders` once a day.
4. That endpoint loops over bikes, compares `currentOdometer` to each `MaintenanceLog.nextDueOdometer`, and for anything due/upcoming, sends a push via **Expo's push notification service** (`expo-server-sdk` on the backend — free, and Expo manages the APNs/FCM credentials for you, so you don't need to set up Firebase yourself).

This is the standard free path for React Native push — Expo's push service is free at any volume for a personal app like this; Firebase Cloud Messaging directly is the alternative if you ever eject from Expo's managed workflow, but it's more setup for no benefit at this scale.

**Web push is a separate concern** (Web Notifications API + service worker + VAPID keys) and isn't the same mechanism as Expo push. Recommend deferring it — the responsive web build can rely on Tier 1 in-app reminders, since the mobile app (which you'll have on you while riding) is where Tier 2 push matters most.

### 7.3 Client patterns — mirror `expense-tracker-client`, don't reinvent

Your existing RN client (`expense-tracker-client`) already has the right shape for this: **React Query + axios only** (no Redux) via a generic `hooks/useApi.ts` (`useFetchData`/`usePost`/`usePatch`/`useDeleteData`) wrapping `utils/axiosInstance.ts`, with each screen as a thin wrapper rendering a component. Reuse that exact hook/screen split for Bike Log instead of introducing new state-management patterns:

- **Monthly Mileage screen** — copy the shape of `MonthlyTransaction.tsx`: month selector (prev/next + "jump to current"), `useFetchData(["mileage-monthly", month], "/bikes/:bikeId/mileage/monthly?targetMonth=...")`, average computed client-side same as `WeeklyAverageCard`.
- **Mileage History screen** — copy the shape of `HistoryPage.tsx`: year selector, `useFetchData(["mileage-yearly", year], ...)`, one card per month (like `HistoryCard`).
- **Lifetime average card** — same idea as `TotalBalanceCard`, fed by `/mileage/lifetime`.
- No charting library exists in `expense-tracker-client` today (stats are plain cards/text via `react-native-paper`) — if you want mileage trend charts later, that's a new dependency (e.g. `react-native-chart-kit`, free/lightweight) rather than an existing pattern; fine to start with cards and add charts as a Phase 2+ nice-to-have.

---

## 8. What's Next

This document is the answer to your ask — project idea, requirements, core logic, schema, and frontend/notification approach. When you're ready to build, the natural order is: `User`/`Bike` + auth → `FuelLog` + `MileageRecord` logic → `MaintenanceType`/`MaintenanceLog` + reminders → mileage/spending stats endpoints → Expo app wired to the API → Tier 2 push once the MVP feels solid.
