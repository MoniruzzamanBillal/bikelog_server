# Bike Accessory List Sort Order

## Goal

`GET /bikes/:bikeId/accessories` must list `status: "pending"` first, then `"purchased"`, then `"cancelled"`, regardless of creation order.

## Design (revised — supersedes the original `statusRank` draft)

**Original draft and why it was not implemented as written.** This spec originally proposed the same pattern as spec 12's first pass for `bikeIssue`: a persisted `statusRank: number` field kept in sync by a `pre("save")` hook. Spec 12 shipped that way first, and it turned out to have a real migration gap — any document that existed before the fix shipped kept `statusRank` at its schema default until individually re-saved, so old documents silently sorted wrong until touched. Spec 12 was subsequently corrected to sort directly on the `status` string field instead, which works with zero migration because `"open" < "resolved"` alphabetically already matches the desired order for that enum.

**That direct-field trick does not transfer here.** `AccessoryStatus` is `{ pending, purchased, cancelled }`, and alphabetically `"cancelled" < "pending" < "purchased"` — the opposite of the desired `pending → purchased → cancelled` order. A plain `.sort("status ...")` would put cancelled first, which is wrong. Per direct user instruction, no persisted rank field and no backfill/migration script — the fix must query correctly off `status` with no derived state.

**Revised approach: one query per status, merged in the declared order.** `getBikeAccessoriesFromDB` now runs three separate `bikeAccessoryModel.find()` queries — one per value of `Object.values(AccessoryStatus)`, i.e. `pending`, then `purchased`, then `cancelled` — each scoped to `{ bike, isDeleted: false, ...otherFilters, status }` and sorted by the client's secondary sort (or `-createdAt` by default), then concatenates the three result arrays in that fixed order. This sorts correctly on any existing document immediately, since it reads only the real `status` field — no new field, no hook, no migration.

**Pagination moves out of `Queryuilder` for this endpoint.** Because the ordering now spans three separate queries, `.skip()`/`.limit()` can't be applied to any single one of them without breaking cross-group continuity (e.g. `?limit=1&page=4` needs to land inside the `purchased` group once `pending` is exhausted, not re-`skip()` within one query in isolation). Instead, all matching documents across the three status buckets are fetched in full, concatenated, and `.slice(skip, skip + limit)` is applied once over the merged array. This still produces exactly one continuous status-grouped order across pages (verified: `?limit=1` walked across 6 fixtures landed in the same pending→purchased→cancelled sequence one document at a time), it just does the slicing in application code instead of via a single Mongo query's `.skip()`/`.limit()`. Acceptable given the small, per-bike, personal-use scale of this collection (a handful of wishlist items per bike, not a paginated feed).

**Client `?sort=` capability is preserved.** `getBikeAccessoriesFromDB` never called `Queryuilder`'s `.filter()`/`.sort()`/`.pagination()`/`.field()` chain for this rewrite (a plain-Mongoose per-status implementation replaces it entirely for this one function), but the sort/fields/pagination defaults are computed with the exact same fallback logic `Queryuilder` used (`sort` → client value or `-createdAt`; `fields` → client value or `-__v`; `limit`/`page` → client value or `10`/`1`), so `GET /bikes/:bikeId/accessories?sort=name` still sorts each status group by `name` ascending, exactly as it did when `Queryuilder`'s bare `.sort()` fallback handled it. `Queryuilder.ts` itself is unchanged — it's simply no longer used by this one function.

**Explicit `?status=` filtering is honored.** If the client passes `?status=purchased` (a value already filtered elsewhere via the existing enum), only that one status is queried instead of iterating all three — preserving the pre-existing (if implicit) ability to filter the list down to a single status.

**No changes to `updateBikeAccessoryInDB`, `bikeAccessory.model.ts`, or `bikeAccessory.interface.ts`.** Since no `statusRank` field is introduced, there is nothing to strip from update payloads and nothing to add to the schema/interface — this spec no longer touches those files at all. The pre-existing note that `updateBikeAccessoryInDB` strips no fields at all (not even `bike`/`isDeleted`) remains flagged but out of scope, exactly as before.

**`bikeAccessory.validation.ts`: unchanged**, confirmed no `statusRank` field in either Zod schema (never was).

## Implementation

1. `bikeAccessory.service.ts`: rewrite `getBikeAccessoriesFromDB` to run one `bikeAccessoryModel.find()` per status (in `Object.values(AccessoryStatus)` order, or just the client's requested status if `?status=` is given), each sorted by the client's `?sort=` value (default `-createdAt`) and `.select()`-projected (default `-__v`), concatenate the per-status result arrays in order, then apply `.slice(skip, skip + limit)` over the merged array for pagination. Total count (`meta`) computed via `bikeAccessoryModel.countDocuments()` over the same effective filter (all three statuses, or just the one requested).
2. No changes to `bikeAccessory.interface.ts`, `bikeAccessory.model.ts`, or `bikeAccessory.validation.ts`.
3. No backfill script — not needed; nothing is derived/persisted, so there is nothing to migrate.

## Dependencies

Spec 11 (the `bikeAccessory` module itself must already exist — it does). Independent of spec 12.

## Verify-when-done

- [x] `yarn build` / `yarn lint` clean.
- [x] `GET /bikes/:bikeId/accessories` returns `pending`, then `purchased`, then `cancelled`, regardless of creation order — verified against real fixtures inserted with out-of-order `createdAt` timestamps.
- [x] Within each status group, `-createdAt` descending order is preserved when no client `?sort=` is given.
- [x] `GET /bikes/:bikeId/accessories?sort=name` still honors the client's secondary sort field within each status group.
- [x] Pagination across multiple pages (`?limit=1` walked across 6 fixtures) reflects one continuous status-group order across pages, not just within a single page.
- [x] An explicit `?status=purchased` filter still returns only that status.
- [ ] `PATCH /:id` changing `status` (any direction — no state machine per spec 11) correctly re-sorts the accessory into its new group on the next list call — implied by querying live `status` directly (no cache/derived field to go stale), not separately re-verified via the HTTP layer in this pass.
- [ ] `enum` validation (existing, unaffected) still rejects an invalid `urgency`/`status` value at the schema level — unchanged code path, not re-verified in this pass.
- [ ] `GET /bikes/:bikeId/accessories?bike=<anotherBikesId>` still never leaks another bike's accessories — unchanged IDOR-stripping logic, not separately re-verified in this pass.
- [ ] Accessories for bike A still never appear in bike B's list, even for the same authenticated user — same as above.
