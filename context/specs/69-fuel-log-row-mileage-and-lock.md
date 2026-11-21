# Spec 69 — Fuel-log list rows carry per-fill mileage + lock state

> Status: **planned** (backend only). Source: app request — the Fuel Logs screen's card shows per-fill **km/l** and a **"Locked — part of a closed mileage period"** note that are *not* on the fuel-log row; the app fetches `GET /bikes/:bikeId/mileage` a second time and merges them client-side. Developer wants the card's data to come from the one `/fuel-logs` call.
> **Hard constraint: additive and non-breaking.** This spec adds only new optional fields. It removes/renames nothing, does not change the `{ result, meta }` envelope, the sort, the pager, the schema, or any existing row field (including spec 60's `kmOnThisFill`/`costPerKm`). A client that ignores the new fields behaves exactly as today.
> Cascade: server half. App consumer = `bikelog_app` spec **75**. Web consumer (if it does the same merge) = `bikelog_client-web-` spec **46**.

## Why

`GET /bikes/:bikeId/fuel-logs` returns each fill-up row, but two things the card renders are computed elsewhere and merged on the client from the mileage endpoint:

- **km/l** — only for a period-closing full-tank log; the app matches `mileageRecord.endOdometer === fuelLog.odometerReading` and reads `mileageRecord.mileageKmPerLiter`.
- **Lock note** — a log inside a closed mileage period; the app tests `mileageRecord.fuelLogIds` membership and shows the period `d MMM → d MMM`.

Both facts already live on persisted `MileageRecord` rows. **Goal:** attach them to each fuel-log row so the client reads them off the row and drops the second call + merge — with byte-identical values to today.

## Decisions

1. **Additive only — current behavior is preserved exactly.** New optional fields on each row; the envelope, existing fields, sort, pager `meta`, schema, and the edit/delete lock guards are all untouched. This is the top priority, not a side note: the regression surface is "did any existing field or shape change?" and the answer must stay "no."

2. **Map-merge the already-persisted `MileageRecord` rows — not a join, not a recompute.** There is **no FK** between `MileageRecord` and `FuelLog` (`fuelLogIds` is a plain `String[]`), so Prisma cannot join them. And `mileageKmPerLiter` is already stored at write time (`createFuelLogIntoDB`), so recomputing would risk divergence. Reusing the stored value guarantees the row's km/l equals what `/mileage` returns today — **zero divergence by construction.**

3. **Two new row fields:**
   - `mileageKmPerLiter: number | null` — the closing full-tank log's stored efficiency; `null` for every non-closing / partial / open row.
   - `lockedPeriod: { startDate: string; endDate: string } | null` — non-null ⇔ the row id is in some record's `fuelLogIds`; carries that record's `periodStartDate` / `periodEndDate`.

4. **Lock is returned as data, not a baked string.** Return the two period dates; the client formats `d MMM → d MMM` and owns the "Locked — …" wording (locale/format is presentation). This keeps the server out of UI copy and lets the app reuse its exact current wording.

5. **One extra read, keyed exactly like the client does today.** `prisma.mileageRecord.findMany({ where: { bikeId } })` — all of the bike's records (small; full history, **not** page-scoped, so none of the off-page-neighbour trouble `kmOnThisFill` had). Build two maps:
   - km/l key = `` `${endOdometer}|${periodEndDate.getTime()}` `` → match a row on `(odometerReading, date)`.
   - lock: each `fuelLogIds[]` member → `{ periodStartDate, periodEndDate }`.
   This is the **same matching rule** the app uses (`endOdometer === odometerReading`; `fuelLogIds.has(id)`), so parity is guaranteed.

6. **Computed in `getFuelLogsFromDB`, beside the existing decoration.** The list service already post-processes rows (`withPeriodFields` adds `kmOnThisFill`/`costPerKm` via a neighbour pass). Add the mileage/lock decoration in the same place, after shaping, before returning `{ result, meta }`.

## The change — `src/app/modules/fuelLog/fuelLog.service.ts`

In `getFuelLogsFromDB` (≈234-307), after the rows are shaped by `toApiShape` + `withPeriodFields`:

1. `const records = await prisma.mileageRecord.findMany({ where: { bikeId } });`
2. `kmPerLiterByClosing = Map<string, number>` keyed `` `${r.endOdometer}|${r.periodEndDate.getTime()}` ``.
3. `periodByLogId = Map<string, { startDate, endDate }>` by iterating `r.fuelLogIds`.
4. Map each row → add:
   - `mileageKmPerLiter: kmPerLiterByClosing.get(\`${row.odometerReading}|${new Date(row.date).getTime()}\`) ?? null`
   - `lockedPeriod: periodByLogId.get(row.id) ?? null` (serialize dates as ISO, same as every other date field).
5. Return the unchanged `{ result, meta }` envelope.

**No** schema change, **no** migration, **no** route/controller change (the controller already forwards `{ result, meta }`).

## Non-breaking checklist (verify these stay true)

- `{ result: Row[], meta: number }` envelope, default `-date` sort, `limit=10`/`page=1`, `createdAt` tiebreaker — all unchanged.
- Every existing row field (`_id`, `bike`, `odometerReading`, `litersAdded`, `isFullTank`, `pricePerLiter`, `totalCost`, `fuelStation`, `date`, `notes`, `receiptImage`, `kmOnThisFill`, `costPerKm`, …) byte-identical to before.
- The edit/delete lock guards (`fuelLog.service.ts` ≈342-344, 402-404, which already test `fuelLogIds`) are **not touched** — this spec only surfaces the same fact on the read path.
- `createFuelLogIntoDB`'s mileage-record write is untouched — this is a read-side decoration only.

## Clients

- **`bikelog_app` spec 75** — drops the `/mileage` merge from the Fuel Logs card path (`findMileageForLog` + `buildLockMap`), reads `row.mileageKmPerLiter` / `row.lockedPeriod`. The `/mileage` call still loads on that screen for `TankForecastCard`, so nothing about the forecast changes.
- **`bikelog_client-web-` spec 46** — only if the web fuel-log list does the same merge (being verified). Additive, so the web is not *forced*; the spec drops the merge for parity if present.

## Verification

- `yarn build` (tsc) + `yarn lint` clean (no *new* findings). `yarn test` unaffected (this is `prisma`-calling, not in the unit suite).
- **Operator / Postman (not run here):** `GET /bikes/:bikeId/fuel-logs?page=1&limit=10&sort=-date` for a bike with closed periods:
  - **V1** a period-closing full-tank row → `mileageKmPerLiter` equals the matching `/mileage` `exactRecord.mileageKmPerLiter`.
  - **V2** a partial row, and the newest/open full-tank row → `mileageKmPerLiter: null`.
  - **V3** a row whose id is inside a closed period → `lockedPeriod` with the record's start/end dates; a row in no record → `lockedPeriod: null`.
  - **V4** diff a row's existing fields against the pre-change response → identical (regression guard for the hard constraint).
  - **V5** `meta` is still the raw count; pager math unchanged.
- **Deploy:** additive, no migration; `deploy.yml` ships on push to `master`. No ordering constraint (old `/mileage` endpoint stays live; clients consume the new fields when their builds ship).
