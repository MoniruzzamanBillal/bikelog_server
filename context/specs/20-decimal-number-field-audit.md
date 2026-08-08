# 20: Decimal Number Field Audit (Odometer + Related Fields)

Status: ✅ Complete (audit confirmed — no backend change required)

## Goal

The user reported that on the frontend, entering a decimal odometer reading (e.g. `408.8`) in the "Add Fuel Log" form triggers a "whole number required" toast, even though other numeric fields (liters, price, cost) already accept decimals fine (`4.5`, `5.88`). Determine whether the backend is the source of this restriction — a `.int()` constraint, a Mongoose schema type, or a truncating computation — and document what (if anything) needs to change here, so the client-side fixes in `bikelog_client-web-` and `bikelog_app` aren't built on a false assumption about what the API actually accepts.

## Context

Full read of every Zod validation schema and Mongoose model that touches `odometerReading` / `currentOdometer` / `intervalKmUsed`:

- `src/app/modules/fuelLog/fuelLog.validation.ts` — `odometerReading: z.number({...})`, no `.int()`.
- `src/app/modules/maintenanceLog/maintenanceLog.validation.ts` — `odometerReading: z.number({...})` and `intervalKmUsed: z.number({...})`, neither has `.int()`.
- `src/app/modules/bike/bike.validation.ts` — `currentOdometer: z.number().nonnegative().optional()`, no `.int()`.
- `fuelLog.model.ts`, `maintenanceLog.model.ts`, `bike.model.ts`, `mileageRecord.model.ts` — every odometer/km field is Mongoose `{ type: Number }`, which is IEEE-754 double under the hood and stores fractional values natively (no separate integer type exists in Mongoose for this).
- `fuelLog.service.ts`, `maintenanceLog.service.ts`, `bike.service.ts`, `bike.utils.ts`, `mileageRecord.service.ts` — grepped for `Math.round`/`Math.floor`/`Math.ceil`/`parseInt`/`Number.isInteger`. The only hit is `maintenanceLog.service.ts`'s `Math.ceil(msRemaining / (1000*60*60*24))` for computing `daysRemaining` in the reminders calculation — unrelated to odometer values, operates on a millisecond duration, not a stored field.
- `postman/dummy-data.md` — documents `odometerReading`/`intervalKmUsed`/`currentOdometer` simply as `number`, no whole-number caveat; sample payloads happen to use whole numbers but nothing in the docs or schema requires it.

**Conclusion: the backend already fully supports decimal odometer/interval values end to end** — validation, storage, and every derived computation (mileage closure, lifetime/monthly/yearly stats, reminders' `nextDueOdometer = odometerReading + intervalKmUsed`) operate on plain floating-point numbers with no rounding or truncation. The reported bug is confirmed to originate entirely in the two frontends — see sibling specs `bikelog_client-web-/context/specs/19-decimal-number-field-fix.md` (native HTML `step` default blocking submission) and `bikelog_app/ai context/specs/23-decimal-number-field-fix.md` (explicit `INT_REGEX` + `parseInt` gating). No backend code change is required to fix the reported bug.

## Design

No functional change proposed. Two optional, separate hardening items are noted below for the user's awareness — neither is needed to fix the reported bug, and both are judgment calls that change behavior slightly, so they should only be done if explicitly requested:

**Optional 1 — floating-point precision clamp.** Since `litersAdded`/`pricePerLiter`/`cost` are typed with `step="0.01"` on the web client, and the app's own `DECIMAL_REGEX` (`/^\d+(\.\d{0,2})?$/`) caps input to 2 decimal places, values arriving at the API are already bounded to 2 decimals by the client. The backend does not itself clamp precision (e.g. a client bug or a direct API call could send `408.123456789`, which would be stored as-is). Adding a `.transform((n) => Math.round(n * 100) / 100)` to the relevant Zod number fields would guarantee consistent 2-decimal storage regardless of client behavior. Not required for the reported bug — flagged only because it's the kind of latent gap this audit surfaced.

**Optional 2 — documentation clarity.** Add a short note to `postman/dummy-data.md`'s field tables (next to `odometerReading`, `intervalKmUsed`, `currentOdometer`) explicitly stating "accepts decimals," to prevent a future client rebuild from re-introducing a whole-number assumption the way the current web/app frontends independently did.

## Implementation

None — no files require modification to resolve the reported bug. If the user opts into Optional 1, the touch points would be:

1. `fuelLog.validation.ts` — `odometerReading` in both `createFuelLogSchema` and `updateFuelLogSchema`.
2. `maintenanceLog.validation.ts` — `odometerReading` and `intervalKmUsed` in both schemas.
3. `bike.validation.ts` — `currentOdometer` in both schemas.

If the user opts into Optional 2, the touch point is `postman/dummy-data.md`'s field-reference tables (no code).

## Dependencies

None. This spec is an audit/confirmation only — the actual fix lives in the two frontend repos' own specs.

## Verify

- [x] No backend change made; re-confirmed by re-reading `fuelLog.validation.ts`, `maintenanceLog.validation.ts`, `bike.validation.ts`, and all four models (`fuelLog`/`maintenanceLog`/`bike`/`mileageRecord`) against this spec's Context section immediately before closing — still no `.int()`, no Mongoose integer type, no truncating computation anywhere in the odometer/interval/currentOdometer path. Findings hold.
- [ ] Optional 1 (precision clamp) not implemented — not requested. If picked up later: `curl`/Postman a fuel log create with `"odometerReading": 408.8` and confirm the stored/returned value round-trips as `408.8` (or as `Math.round(408.8*100)/100` if the clamp is added), not truncated to `408`.
