# 28: Make Maintenance Log's Service Interval (`intervalKmUsed`) Optional

Status: ✅ Complete

## Goal

Per direct user request: `intervalKmUsed` ("Service Interval (km)") is currently a required field on `POST /bikes/:bikeId/maintenance-logs`, alongside `maintenanceType`, `odometerReading`, and `cost`. The user wants it optional — e.g. a one-off repair or a maintenance type that has no recurring interval shouldn't force the rider to type a number that doesn't apply.

## Context

- `intervalKmUsed` is not a leaf field — it drives a derived, currently-**required** field: `nextDueOdometer = odometerReading + intervalKmUsed`, computed in `maintenanceLog.service.ts`'s `computeNextDueOdometer`. Making `intervalKmUsed` optional means `nextDueOdometer` can no longer always be computed, so it must become optional too. This is the one piece of real design work in this spec — everywhere else is a mechanical required→optional flip.
- `nextDueOdometer` currently feeds `getRemindersFromDB`'s **km-based** overdue/upcoming check unconditionally: `kmRemaining = log.nextDueOdometer - bike.currentOdometer`. If a log has no `intervalKmUsed` (hence no `nextDueOdometer`), this line breaks (`NaN` arithmetic against `undefined`).
- Reminders already support a **second, independent** basis: `nextDueDate` (also optional today), which drives its own date-based overdue/upcoming check further down the same function. The two checks currently OR together (`status = kmOverdue ? "overdue" : ... ; else if (dateOverdue) status = "overdue"`, etc.) — a log can already trigger a reminder from either signal alone.
- **Design decision (this spec)**: when `intervalKmUsed`/`nextDueOdometer` is absent, that log's reminder becomes date-only — the km-based branch is skipped entirely for it, not defaulted to some placeholder. If a log also lacks `nextDueDate`, it simply never produces a reminder — this is not a new gap, `nextDueDate`-less, km-only logs already have the mirror-image behavior today (date branch just never fires).
- `serviceDate` is a useful contrast: it's `required` in the Mongoose schema but has a `default: Date.now` and is `.optional()` at the Zod layer — the two layers are allowed to disagree because the service always fills it in before `.create()`. `intervalKmUsed`/`nextDueOdometer` have no such default (there's no sane default interval), so this spec makes both layers agree: genuinely optional, no default, `undefined` when not supplied.
- Confirmed nothing else in the backend reads `intervalKmUsed`/`nextDueOdometer` outside `maintenanceLog.service.ts` (model, interface, validation, this service file) — no cron job, no other module, no aggregation pipeline references either field.

## Design

### `src/app/modules/maintenanceLog/maintenanceLog.validation.ts`

`createMaintenanceLogSchema.body.intervalKmUsed`: drop the `required_error` object, same shape as the sibling optional fields:

```ts
intervalKmUsed: z.number().optional(),
```

(`updateMaintenanceLogSchema` is already `.optional()` — no change needed there.)

### `src/app/modules/maintenanceLog/maintenanceLog.interface.ts`

```ts
intervalKmUsed?: number;
nextDueOdometer?: number;
```

(both currently plain `number`.)

### `src/app/modules/maintenanceLog/maintenanceLog.model.ts`

- `intervalKmUsed`: drop `required: [true, "interval km used is required "]` → just `{ type: Number }`.
- `nextDueOdometer`: drop `required: [true, "next due odometer is required "]` → just `{ type: Number }`.

### `src/app/modules/maintenanceLog/maintenanceLog.service.ts`

`computeNextDueOdometer` itself is unchanged (still takes two required numbers) — callers now guard before calling it instead.

**`createMaintenanceLogIntoDB`**:

```ts
const nextDueOdometer =
  payload.intervalKmUsed !== undefined
    ? computeNextDueOdometer(payload.odometerReading!, payload.intervalKmUsed)
    : undefined;

const logData = {
  ...payload,
  bike: bikeId,
  nextDueOdometer,
  serviceDate: payload.serviceDate ?? new Date(),
};
```

(Mongoose omits a key whose value is `undefined` on `.create()`, so this doesn't write a literal `null`.)

**`updateMaintenanceLogInDB`**: currently always recomputes when either `odometerReading` or `intervalKmUsed` is touched. Extend the guard to also require the _effective_ interval (new-or-existing) to actually be defined — a log that never had an interval and isn't being given one now must not get a stray `nextDueOdometer` from a lone `odometerReading` edit:

```ts
const newOdometer = updateData.odometerReading ?? log.odometerReading;
const newInterval = updateData.intervalKmUsed ?? log.intervalKmUsed;
if (
  (updateData.odometerReading !== undefined ||
    updateData.intervalKmUsed !== undefined) &&
  newInterval !== undefined
) {
  updateData.nextDueOdometer = computeNextDueOdometer(newOdometer, newInterval);
}
```

Note: this spec does **not** add a way to explicitly clear an already-set `intervalKmUsed` back to "none" via PATCH — consistent with how every other optional field on this model (`oilType`, `serviceCenter`, `notes`, ...) already behaves (PATCH can set or overwrite, never explicitly unset, since `z.object` optional fields are simply omitted rather than accepting `null`). Out of scope unless the user asks for it separately.

**`getRemindersFromDB`**: guard the km-based branch on `nextDueOdometer` being defined; only compute `kmRemaining`/`kmOverdue`/`kmUpcoming` when it is. The reminder object's `nextDueOdometer`/`kmRemaining` become optional in the inline types and are only attached when present (mirrors the existing `if (log.nextDueDate) { reminder.nextDueDate = ...; reminder.daysRemaining = ...; }` pattern already used for the date side):

```ts
const reminders: Array<{
  maintenanceType: typeof logs[0]["maintenanceType"];
  lastServiceDate: Date;
  lastOdometerReading: number;
  nextDueOdometer?: number;
  nextDueDate?: Date;
  status: "overdue" | "upcoming";
  kmRemaining?: number;
  daysRemaining?: number;
}> = [];

for (const [, log] of latestPerType) {
  let status: "overdue" | "upcoming" | null = null;
  let kmRemaining: number | undefined;

  if (log.nextDueOdometer !== undefined) {
    kmRemaining = log.nextDueOdometer - bike.currentOdometer;
    const kmOverdue = kmRemaining <= 0;
    const kmUpcoming = !kmOverdue && kmRemaining <= 50;
    if (kmOverdue) status = "overdue";
    else if (kmUpcoming) status = "upcoming";
  }

  let daysRemaining: number | undefined;
  if (log.nextDueDate) {
    // unchanged date branch, still able to set/upgrade `status`
  }

  if (status) {
    const reminder: { ...; nextDueOdometer?: number; kmRemaining?: number; ... } = {
      maintenanceType: log.maintenanceType,
      lastServiceDate: log.serviceDate,
      lastOdometerReading: log.odometerReading,
      status,
    };
    if (log.nextDueOdometer !== undefined) {
      reminder.nextDueOdometer = log.nextDueOdometer;
      reminder.kmRemaining = Math.max(0, kmRemaining!);
    }
    if (log.nextDueDate) {
      reminder.nextDueDate = log.nextDueDate;
      reminder.daysRemaining = daysRemaining;
    }
    reminders.push(reminder);
  }
}
```

**Open question for the user**: a reminder with no `kmRemaining` (interval-less log, date-only) means both frontends' reminder banners — which today always render a "Due in N km" / "Overdue by N km" line first — need a fallback message. This spec's backend half doesn't fix the frontend rendering; see the paired `bikelog_app` spec (33) for that half, and note the **`bikelog_client-web-` reminders banner is out of scope** for this pass (per this repo's own cross-project rule, a gap there should be logged in that project's own `progress-tracker.md` Known Gaps, not fixed here) unless the user asks for it explicitly.

### `postman/dummy-data.md` / `postman/bikelog-api.postman_collection.json`

Following spec 27's precedent: update the Maintenance Logs section's field table to mark `intervalKmUsed` optional, and add a short note explaining the new "date-only reminder" behavior when it's omitted.

## Implementation

1. ✅ `src/app/modules/maintenanceLog/maintenanceLog.validation.ts` — `intervalKmUsed` optional in create schema.
2. ✅ `src/app/modules/maintenanceLog/maintenanceLog.interface.ts` — `intervalKmUsed?`, `nextDueOdometer?`.
3. ✅ `src/app/modules/maintenanceLog/maintenanceLog.model.ts` — drop `required` on both fields.
4. ✅ `src/app/modules/maintenanceLog/maintenanceLog.service.ts` — conditional `nextDueOdometer` computation in create/update; guard the km-based branch in `getRemindersFromDB`.
5. ✅ `postman/dummy-data.md` — documented the new optionality (field table + `nextDueOdometer`/fallback-reminder note). Collection JSON left as-is — its example body/description didn't assert required-ness and stays valid either way.
6. ✅ `context/progress-tracker.md` — row flipped Not Started → In Progress → Complete; Recent Activity entry added.

## Dependencies

None new. Paired with `bikelog_app`'s spec 33 (frontend form + display changes) — that spec depends on this one being live first (or at least on the client already tolerating `intervalKmUsed`/`nextDueOdometer` being absent from a response, which it currently does not — see spec 33's Context section).

## Verify

- [x] `POST .../maintenance-logs` with `intervalKmUsed` omitted → `201`, created doc has no `intervalKmUsed`/`nextDueOdometer` fields (or both `undefined`, not `0`/`null`) — confirmed live.
- [x] `POST .../maintenance-logs` with `intervalKmUsed` present → `201`, `nextDueOdometer` computed exactly as before (no regression) — confirmed live (`odometerReading: 1200, intervalKmUsed: 150 → nextDueOdometer: 1350`).
- [x] `PATCH .../maintenance-logs/:id` on an interval-less log, touching only `odometerReading` → `200`, `nextDueOdometer` stays absent (not recomputed against a missing interval) — confirmed live.
- [x] `PATCH .../maintenance-logs/:id` adding `intervalKmUsed` to a previously interval-less log → `200`, `nextDueOdometer` now computed — confirmed live (`1250 + 5000 → 6250`).
- [x] `GET .../reminders` with a mix of interval-less (date-only) and normal (km-based) logs across different maintenance types → each reminder shows the right shape (`kmRemaining`/`nextDueOdometer` present only for km-based logs; date-only logs still produce a reminder purely from `nextDueDate` when within its overdue/upcoming window) — confirmed live: a km-based log (`nextDueOdometer` at the bike's current odometer) returned `status: "overdue"` with `nextDueOdometer`/`kmRemaining` and no date fields; a separate interval-less log with a past `nextDueDate` returned `status: "overdue"` with `nextDueDate`/`daysRemaining` and no km fields.
- [x] `GET .../reminders` for an interval-less log with no `nextDueDate` either → produces no reminder at all (matches existing behavior for the inverse case) — confirmed live.
- [x] `yarn build` clean; `yarn lint` — no new errors beyond the existing baseline (0 errors, 14 pre-existing warnings, none in touched files).

All test data (throwaway test user's bike + 5 maintenance logs, created against the real `yarn dev` instance pointed at the shared dev database) was soft-deleted immediately after verification. No bugs found during testing — every check passed on the first pass, so no follow-up fix-spec was needed.
