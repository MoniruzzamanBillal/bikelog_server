# Bike Accessory List Sort Order

## Goal

Change `GET /bikes/:bikeId/accessories` so accessories always list `status: "pending"` first, then `"purchased"`, then `"cancelled"` — the point of the wishlist is to see what's still outstanding at a glance, and purchased/cancelled entries currently interleave with pending ones based on creation order alone.

This is a targeted ordering fix on top of the already-shipped spec 11 module, not a new endpoint or new client-facing field.

## Design

**Ownership and scoping are unchanged.** `getBikeAccessoriesFromDB` keeps its existing `findOwnedBikeOrThrow` call and the `bike`/`isDeleted` query-stripping IDOR guard from spec 11 exactly as-is.

**Same DB-level-sort and no-aggregation rationale as spec 12** applies here: `.pagination()` slices before results return, so an in-memory JS re-sort would only reorder the current page, not the paginated whole; and `Queryuilder` only wraps `Query`, never `Aggregate` — introducing `.aggregate()` here would be the first such call in the codebase and would require manually re-adding `isDeleted: false` to `$match` since aggregation bypasses the soft-delete `pre("find")` hooks. A materialized field is the simpler fit, exactly as in spec 12.

**Materialized `statusRank`, kept in sync by a `pre("save")` hook.** Add a persisted `statusRank: number` field, computed as `Object.values(AccessoryStatus).indexOf(this.status)` — `pending` → `0`, `purchased` → `1`, `cancelled` → `2`, per the enum's own declared order. Recompute it unconditionally on every save inside a `bikeAccessorySchema.pre("save")` hook, same shape and same no-`isModified`-guard-needed reasoning as spec 12's `bikeIssue` hook. `Model.create()` calls `.save()` internally, so accessory creation is covered automatically.

**Real wrinkle specific to this module: preserving the client's existing `?sort=` capability.** Unlike `bikeIssue`'s list endpoint (which already hardcodes `.sort("-dateReported")` and has therefore never honored a client `?sort=`), `bikeAccessory.service.ts`'s `getBikeAccessoriesFromDB` currently calls `Queryuilder`'s `.sort()` with **no argument** — meaning it falls back to `this.query?.sort`, so `GET /bikes/:bikeId/accessories?sort=name` (or any other field) **is honored today**, with `-createdAt` used only when no `?sort=` is supplied. Hardcoding `.sort("statusRank -createdAt")` the same way spec 12 does for `bikeIssue` would silently regress that existing capability. Instead, build the compound sort string inside the service from the client's own sort value: read it from the (already-sanitized) query object before calling `.sort()`, and always prefix `statusRank` as the primary key while preserving/composing whatever secondary sort the client asked for, defaulting to `-createdAt` only when none was given:
```ts
const clientSort =
  typeof sanitizedQuery.sort === "string" ? sanitizedQuery.sort : undefined;
const sortBy = `statusRank ${clientSort ?? "-createdAt"}`;
```
then pass `.sort(sortBy)` explicitly instead of the current bare `.sort()`. This still routes through `Queryuilder.sort(sortBy)` unmodified — its existing `.split(",").join(" ")` normalization already handles a client value containing commas correctly when prefixed this way (e.g. `"statusRank name,-urgency"` splits on the one comma present and joins to `"statusRank name -urgency"`), so `Queryuilder.ts` itself needs no change.

**`updateBikeAccessoryInDB` already routes through `.save()`** (`Object.assign(accessory, payload); await accessory.save();`), so the `pre("save")` hook already fires correctly on every update — no call-site change needed there, unlike `bikeIssue`'s status-mutation bug. It does, however, need `statusRank` defensively stripped from `payload` before `Object.assign`, the same as `owner`/`currentOdometer` are stripped in `bike.service.ts` and `status`/`statusRank` in `bikeIssue.service.ts`'s own generic update. **Flagged but not fixed here:** `updateBikeAccessoryInDB` currently has zero stripping of any field at all, not even `bike`/`isDeleted` — pre-existing scope creep beyond this spec's ordering fix; worth a follow-up if the user wants the broader hardening, but only `statusRank` stripping is in scope for this change.

**`statusRank` must never be client-settable** — `bikeAccessory.validation.ts`'s Zod schemas must NOT gain a `statusRank` field in either `createBikeAccessorySchema` or `updateBikeAccessorySchema`. Deliberate omission, not an oversight.

**Response shape and migration note** — identical reasoning to spec 12: `statusRank` will appear in every response the same way `isDeleted` already does (no regression, matches existing house style), and pre-existing documents keep `statusRank: 0` until next touched, for which an optional `src/scripts/backfillBikeAccessoryStatusRank.ts` (mirroring `seedMaintenanceTypes.ts`'s pattern) is the lightweight in-house-style fix.

## Implementation

1. `bikeAccessory.interface.ts`: add `statusRank: number` to `TBikeAccessory`.
2. `bikeAccessory.model.ts`: add schema field `statusRank: { type: Number, default: 0 }`; add a `pre("save")` hook setting `this.statusRank = Object.values(AccessoryStatus).indexOf(this.status)`.
3. `bikeAccessory.service.ts`: in `getBikeAccessoriesFromDB`, replace the bare `.sort()` call with a computed `sortBy = "statusRank " + (clientSort ?? "-createdAt")` string and pass it explicitly, preserving any client `?sort=` as the secondary key; in `updateBikeAccessoryInDB`, add `delete payload.statusRank` before `Object.assign`.
4. `bikeAccessory.validation.ts`: no changes — confirm `statusRank` is intentionally absent from every Zod schema.
5. (Optional) `src/scripts/backfillBikeAccessoryStatusRank.ts`: one-off re-save script for pre-existing documents, analogous to spec 12's.

## Dependencies

Spec 11 (the `bikeAccessory` module itself must already exist — it does). No dependency on spec 12 — the two modules are independent and can be implemented/verified in either order.

## Verify-when-done

- [ ] `yarn build` / `yarn lint` clean.
- [ ] `GET /bikes/:bikeId/accessories` returns `pending`, then `purchased`, then `cancelled`, regardless of creation order (create fixtures out of status order and confirm).
- [ ] Within each status group, `-createdAt` descending order is preserved when no client `?sort=` is given.
- [ ] `GET /bikes/:bikeId/accessories?sort=name` still honors the client's secondary sort field within each status group — confirms this fix didn't regress the pre-existing client-sort capability (a capability `bikeIssue`'s list never had to preserve, since it never had it).
- [ ] `PATCH /:id` changing `status` (any direction — no state machine per spec 11) correctly updates `statusRank`, and the accessory re-sorts into its new group on the next list call.
- [ ] `PATCH /:id` with a spoofed `statusRank` in the body has zero effect on the persisted value, while other fields in the same request still update.
- [ ] Pagination across multiple pages (e.g. `?limit=1`) reflects one continuous status-group order across pages, not just within a single page.
- [ ] `enum` validation (existing, unaffected) still rejects an invalid `urgency`/`status` value at the schema level.
- [ ] `GET /bikes/:bikeId/accessories?bike=<anotherBikesId>` still never leaks another bike's accessories.
- [ ] Accessories for bike A still never appear in bike B's list, even for the same authenticated user.
