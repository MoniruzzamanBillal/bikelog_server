# Bike Accessory Optional Price

## Goal

Let a `bikeAccessory` wishlist entry optionally record how much it costs — the user can supply a `price` when creating/updating an accessory, or omit it entirely (e.g. still shopping around, price not yet known).

This is a small additive field on top of the already-shipped spec 11 module, not a new endpoint and not a state-machine change.

## Design

**Plain optional field, no default, no derived state.** Add `price?: number` to `TBikeAccessory` (`bikeAccessory.interface.ts`) and a matching `price: { type: Number }` schema field (`bikeAccessory.model.ts`) — no `required`, no `default`, mirroring how other optional fields are already declared in the codebase (e.g. `fuelLog.model.ts`'s `fuelStation`/`notes`). Omitting `price` on create simply leaves it unset — nothing computes or defaults it.

**Validation matches the existing cost-field convention.** `bikeAccessory.validation.ts` gains `price: z.number().positive().optional()` in both `createBikeAccessorySchema` and `updateBikeAccessorySchema` — `.positive()` matches every other cost-like field already validated this way in the codebase (`fuelLog.validation.ts`'s `pricePerLiter`, `totalCost`, `litersAdded` all use `.positive()`), rejecting `0`/negative values while remaining fully optional.

**No service-layer changes needed.** `createBikeAccessoryIntoDB` already does `{ ...payload, bike: bikeId }`, a spread that passes `price` through automatically once validation allows it. `updateBikeAccessoryInDB` already does a generic `Object.assign(accessory, payload)` with no field allowlist — `price` updates (add, change, or leave unset) flow through with zero code changes there too, the same way `description` needed no service code in `bikeIssue` beyond validation.

**Response shape.** `price` will appear in every list/get-by-id response whenever set, the same way every other field does today — no field is ever hidden via `select: false` in this codebase, so nothing needs hiding or stripping.

**Explicitly out of scope for this spec.** Wiring accessory `price` into `spending.service.ts`'s category totals/breakdown is a separate, larger change (spec 09 currently only sums `FuelLog`/`MaintenanceLog`) and is not implemented here — noted as a possible follow-up only.

## Implementation

1. `bikeAccessory.interface.ts`: add `price?: number;` to `TBikeAccessory`.
2. `bikeAccessory.model.ts`: add `price: { type: Number }` to the schema (optional, no default).
3. `bikeAccessory.validation.ts`: add `price: z.number().positive().optional()` to both `createBikeAccessorySchema` and `updateBikeAccessorySchema`.
4. No changes to `bikeAccessory.service.ts`, `bikeAccessory.controller.ts`, or `bikeAccessory.route.ts` — the existing generic create/update code paths already handle an optional passthrough field.

## Dependencies

Spec 11 (the `bikeAccessory` module itself must already exist — it does). Independent of specs 12/13.

## Verify-when-done

- [x] `yarn build` / `yarn lint` clean.
- [x] `POST /bikes/:bikeId/accessories` without `price` in the body succeeds, response has no `price` set, matching the "price is optional" requirement.
- [x] `POST /bikes/:bikeId/accessories` with a valid positive `price` succeeds and the value is persisted/returned.
- [x] `POST .../accessories` with `price: 0` or a negative `price` is rejected with a 400 (Zod `.positive()` validation).
- [x] `PATCH /bikes/:bikeId/accessories/:id` can add/change `price` on an existing accessory that didn't have one.
- [x] Existing accessories created before this change (no `price` field at all) still list/fetch normally with no errors.
