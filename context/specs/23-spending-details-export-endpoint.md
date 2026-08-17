# 23: Spending Details Export Endpoint

Status: ⛔ Not started

## Goal

Add a new read-only endpoint that returns the individual fuel-log/maintenance-log line items (date, category, description, amount, vendor, remarks) behind a given spending period — the raw detail the existing `/spending-summary` endpoint discards after reducing it into `categoryBreakdown` totals. This is the data source the web client's upcoming PDF export feature (`bikelog_client-web-` spec 21) will consume; no PDF/file generation happens on this backend.

## Design

### Why a new endpoint instead of reusing `/spending-summary`

`spending.service.ts`'s `computeSpendingForRange` already fetches exactly the two collections needed (`fuelLogModel`, `maintenanceLogModel`), date-filtered the same way (`FuelLog.date`, `MaintenanceLog.serviceDate` — never `createdAt`, per `architecture.md` invariant #8) — but it immediately `.reduce()`s them into `{category, total}` pairs and throws the source documents away. Rather than duplicate that fetch-and-filter logic in a new file, add a sibling function in `spending.service.ts` that returns the raw per-record list using the identical query shape, then map each record into a common shape.

### Scope: fuel + maintenance only, matching existing spending scope

`BikeAccessory` has a `price` field but no date field and is already excluded from `/spending-summary`'s aggregation today — this endpoint keeps that same scope (fuel + maintenance only) rather than expanding what "spending" means in this app. Flag this as a known limitation, not something to silently work around.

### Response shape

```ts
// spending.interface.ts — add alongside the existing TSpendingSummary/TSpendingCategoryBreakdown types
export type TSpendingRecordSource = "fuel" | "maintenance";

export type TSpendingRecord = {
  date: Date;
  category: string;       // "Fuel", or the maintenanceType's name
  description: string;    // synthesized fuel label, or partsReplaced.join(", ") || maintenanceType name
  amount: number;          // totalCost, or cost
  vendor: string | null;   // fuelStation, or serviceCenter — null if not recorded
  remarks: string | null;  // notes — null if not recorded
  source: TSpendingRecordSource;
};

export type TSpendingDetails = {
  period: "month" | "year" | "lifetime";
  targetMonth?: string;
  targetYear?: string;
  totalSpending: number;
  categoryBreakdown: TSpendingCategoryBreakdown[];
  records: TSpendingRecord[];  // sorted ascending by date (oldest first) — reads as a chronological ledger
};
```

### Service logic (`spending.service.ts`)

```ts
const computeSpendingDetailsForRange = async (
  bikeId: string,
  startDate?: Date,
  endDate?: Date,
): Promise<{
  totalSpending: number;
  categoryBreakdown: { category: string; total: number }[];
  records: TSpendingRecord[];
}> => {
  const fuelLogsPromise = fuelLogModel
    .find({
      bike: bikeId,
      isDeleted: false,
      ...(startDate && endDate ? { date: { $gte: startDate, $lte: endDate } } : {}),
    })
    .lean();

  const maintenanceLogsPromise = maintenanceLogModel
    .find({
      bike: bikeId,
      isDeleted: false,
      ...(startDate && endDate ? { serviceDate: { $gte: startDate, $lte: endDate } } : {}),
    })
    .populate("maintenanceType", "name")
    .lean();

  const [fuelLogs, maintenanceLogs] = await Promise.all([
    fuelLogsPromise,
    maintenanceLogsPromise,
  ]);

  const fuelRecords: TSpendingRecord[] = fuelLogs.map((log) => ({
    date: log.date,
    category: "Fuel",
    description: `${log.litersAdded}L${log.isFullTank ? " (Full Tank)" : ""} @ ৳${log.pricePerLiter}/L`,
    amount: log.totalCost,
    vendor: log.fuelStation ?? null,
    remarks: log.notes ?? null,
    source: "fuel",
  }));

  const maintenanceRecords: TSpendingRecord[] = maintenanceLogs.map((log) => {
    const mt = log.maintenanceType as unknown as { _id: string; name: string } | null;
    const category = mt?.name ?? "Unknown";
    return {
      date: log.serviceDate,
      category,
      description: log.partsReplaced?.length ? log.partsReplaced.join(", ") : category,
      amount: log.cost,
      vendor: log.serviceCenter ?? null,
      remarks: log.notes ?? null,
      source: "maintenance",
    };
  });

  const records = [...fuelRecords, ...maintenanceRecords].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  // categoryBreakdown/totalSpending: reuse the exact same reduce logic computeSpendingForRange
  // already uses, applied to the same fuelLogs/maintenanceLogs — do not diverge from that math.
  // (Implementer: factor the category-breakdown reduce step into a small shared helper both
  // computeSpendingForRange and computeSpendingDetailsForRange call, rather than copy-pasting it,
  // since duplicated reduce logic is the kind of thing that silently drifts.)

  return { totalSpending, categoryBreakdown, records };
};
```

`getSpendingDetailsFromDB(bikeId, userId, period, targetMonth?, targetYear?)` should resolve `startDate`/`endDate` from `period` using the exact same date-range resolution `getSpendingSummaryFromDB` already uses (extract that resolution into a shared helper if it isn't already one, rather than re-deriving month/year boundary math a second time) — including ownership verification (`findOwnedBikeOrThrow(bikeId, userId)`), matching this module's existing convention of checking ownership in the service layer.

### Route / controller

New route on the existing spending router, alongside `/` and `/trend`:

```ts
router.get("/details", authCheck, spendingController.getSpendingDetails);
```

Full path: `GET /bikes/:bikeId/spending-summary/details?period=month|year|lifetime&targetMonth=YYYY-MM&targetYear=YYYY`. Controller validates `period`/`targetMonth`/`targetYear` inline, mirroring `getSpendingSummary`'s existing validation exactly (same required-param rules per period — `targetMonth` required when `period=month`, `targetYear` required when `period=year`, neither needed for `lifetime`) — don't invent a different validation contract for this sibling endpoint. Controller stays thin: call the service, respond via `sendResponse(res, { status: httpStatus.OK, success: true, message: "Spending details retrieved successfully", data })`.

### Files to modify

| Path | Action | Notes |
|---|---|---|
| `src/app/modules/spending/spending.interface.ts` | Modify | Add `TSpendingRecordSource`, `TSpendingRecord`, `TSpendingDetails`. |
| `src/app/modules/spending/spending.service.ts` | Modify | Add `computeSpendingDetailsForRange` (or extend `computeSpendingForRange` to optionally include records — implementer's call, whichever avoids duplicating the fetch/reduce logic) and `getSpendingDetailsFromDB`. |
| `src/app/modules/spending/spending.controller.ts` | Modify | Add `getSpendingDetails`, mirroring `getSpendingSummary`'s param validation and response pattern. |
| `src/app/modules/spending/spending.route.ts` | Modify | Add `router.get("/details", authCheck, spendingController.getSpendingDetails);`. |
| `postman/bikelog-api.postman_collection.json` | Modify | Add a request under the "Spending Summary" folder for the new `/details` endpoint, matching the existing 4 requests' style (status-code test script, no saved response body needed). |

No new npm dependency — this is pure Mongoose querying, same as every other endpoint in this module.

## Implementation

1. Add `TSpendingRecordSource`, `TSpendingRecord`, `TSpendingDetails` to `spending.interface.ts`.
2. In `spending.service.ts`: add the fuel/maintenance-to-`TSpendingRecord` mapping and the new `computeSpendingDetailsForRange`/`getSpendingDetailsFromDB` functions, reusing (not duplicating) the existing date-range-resolution and category-breakdown-reduce logic from the current `getSpendingSummaryFromDB`/`computeSpendingForRange`.
3. Add `getSpendingDetails` to `spending.controller.ts`, mirroring `getSpendingSummary`'s inline query validation.
4. Add the `GET /details` route in `spending.route.ts`, behind `authCheck` like every other route in this file.
5. Add a Postman request for the new endpoint.
6. Manually verify against dummy data per the Verify checklist below.
7. Update `context/progress-tracker.md`: new Recent Activity entry + a spec 23 row in the Spec Implementation Status table.

## Dependencies

Spec 09 (Spending Summary) and spec 15 (trend endpoint) must exist first — this spec extends the same module they created. This spec is itself a dependency of `bikelog_client-web-`'s spec 21 (Spending PDF Export), which consumes this endpoint — build this one first.

## Verify

- [ ] `GET /bikes/:bikeId/spending-summary/details?period=month&targetMonth=YYYY-MM` returns `records` containing every fuel log (`date` within the month) and every maintenance log (`serviceDate` within the month) for that bike, each mapped to the `TSpendingRecord` shape above.
- [ ] `records` is sorted ascending by `date` (oldest first).
- [ ] `totalSpending` and `categoryBreakdown` in this endpoint's response exactly match what `/spending-summary` (the existing endpoint) returns for the same `period`/`targetMonth`/`targetYear` — no drift between the two endpoints' totals.
- [ ] `period=year` and `period=lifetime` both work with the same param rules as the existing `/spending-summary` endpoint (400 if a required param is missing for that period).
- [ ] A fuel log with no `fuelStation` set returns `vendor: null` (not `undefined`, not an empty string) in its record; same for a maintenance log with no `serviceCenter`, and for `notes` → `remarks` on both.
- [ ] Soft-deleted (`isDeleted: true`) fuel/maintenance logs never appear in `records`.
- [ ] Requesting another user's bike 403/404s the same way `/spending-summary` already does (ownership check enforced).
- [ ] Postman collection has a new request for `/spending-summary/details` alongside the existing 4 Spending Summary requests.
- [ ] `context/progress-tracker.md` updated with a new spec 23 row.
- [ ] TypeScript compiles clean (`yarn build` or equivalent type-check) and lint is clean.
