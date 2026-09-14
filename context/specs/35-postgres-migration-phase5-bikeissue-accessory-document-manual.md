# Postgres Migration — Phase 5: `bikeIssue`, `bikeAccessory`, `bikeDocument`, `bikeManualChunk`

## Status

Proposed — not yet implemented. Fifth of the phased Mongoose→Prisma rewrites from `mongodb-to-postgres-migration-plan.md` (repo root). Depends on Phase 2 (spec 32 — `bike`/`findOwnedBikeOrThrow` in Prisma) landed. Does **not** depend on Phase 3 or 4 — these four modules have no FK relationship to `FuelLog`/`MaintenanceLog`, only to `Bike`.

## Goal

Rewrite the four independent, CRUD-shaped modules the top-level plan groups into one phase. All four share the same shape of problem (ownership-scoped CRUD via `findOwnedBikeOrThrow`, soft delete except `bikeManualChunk`, an embedded-image/file `Json` column) but each has its own wrinkle worth calling out individually below.

## Design decisions — shared across all four

### A. Field renames (same pattern as specs 32–34)

`bikeId` (Prisma) → `bike` (client) on every returned row of `bikeIssue`/`bikeAccessory`/`bikeDocument`. `bikeManualChunk` is internal-only (never serialized to an HTTP response — see §D), so it needs no remap.

### B. `Json` array fields lose their per-item Mongoose sub-`_id` — must synthesize one

This is the one genuinely new problem in this phase, affecting `bikeIssue.images[]` and `bikeDocument.files[]` (not `bikeAccessory.productImage`, which is a single object, not an array — see §D2). Today, Mongoose auto-assigns each array sub-document its own `_id` (confirmed: `images`/`files` sub-schemas don't set `_id: false`, unlike the single-object `receiptImage`/`serviceImage`/`productImage`/`manual` fields which do), and `DELETE /:id/images/:imageId` / `DELETE /:id/files/:fileId` match against it (`image._id?.toString() === imageId`).

Per the top-level plan's decision #4, these arrays become plain `Json?` columns in Postgres — Postgres/Prisma has no concept of a queryable sub-id inside a JSON blob. The read-modify-write pattern must synthesize a stable id explicitly when each item is added, and operate on the whole array in application code:

```ts
// adding images (bikeIssue) / files (bikeDocument)
const newItems = files.map((file) => ({
  _id: generateObjectId(), // synthesized — nothing DB-side assigns this anymore
  url: file.path,
  publicId: file.filename,
  // ...bikeDocument also includes resourceType/originalName/mimeType here
}));
const updated = [...(existing.images ?? []), ...newItems];
await prisma.bikeIssue.update({ where: { id }, data: { images: updated } });

// deleting by id — filter in JS, write the whole array back
const target = existing.images?.find((img: any) => img._id === imageId);
if (!target) throw new AppError(httpStatus.NOT_FOUND, "Image not found");
await deleteCloudinaryImage(target.publicId);
const remaining = existing.images?.filter((img: any) => img._id !== imageId);
await prisma.bikeIssue.update({ where: { id }, data: { images: remaining } });
```

Keep the field named `_id` (not `id`) inside the JSON blob itself — that's what both clients' image/file types already expect (`TBikeIssueImage`/`TBikeDocumentFile` both type it as `_id?: ObjectId` today, which serializes as a plain string either way) and it avoids a confusing collision with the parent row's own `id`→`_id` remap from §A. No `.toString()` needed anywhere once synthesized as a plain string via `generateObjectId()` — that was only ever there to coerce a Mongoose ObjectId.

### C. Soft delete (top-level plan decision #3) applies to `bikeIssue`, `bikeAccessory`, `bikeDocument` — not `bikeManualChunk`

Same explicit-`isDeleted: false`-on-every-query rule as every prior phase, for three of these four models. `bikeManualChunk` was never a soft-delete collection (derived data, same convention as `mileageRecord` — regenerated wholesale on manual replace/delete via `deleteMany` + `insertMany`, never individually soft-deleted).

## `bikeIssue` — module-specific notes

- `updateBikeIssueStatus`'s "no-op transition" guard (`if (issue.status === status) throw 400`) and the open↔resolved toggle are pure state checks, untouched by the DB swap.
- `getBikeIssuesFromDB`'s default sort is `"status -dateReported"` — a **space-separated multi-field Mongoose sort string** passed directly as an argument (not from `req.query.sort`). This is different from spec 33 §E's `buildPrismaListQuery`, which only splits `defaultSort` on commas — passing `"status -dateReported"` through unchanged would parse as one garbage field name. **Fix the shared helper** (built in Phase 3, first reused here) to split on whitespace-or-comma uniformly: `sortStr.trim().split(/[\s,]+/)`. This is a real, needed fix to already-landed Phase 3/4 code, not a new one-off — once fixed, `fuelLog`/`maintenanceLog`'s existing comma-based usage keeps working unchanged (whitespace-splitting a string with no spaces is a no-op).
- Reuses `buildPrismaListQuery` per spec 33 §E, same IDOR-stripping pattern (`delete sanitizedQuery.bike; delete sanitizedQuery.isDeleted;` before calling it).

## `bikeAccessory` — module-specific notes

### D1. Does **not** use `Queryuilder` — has its own bespoke, non-reusable list query; port the multi-query grouping strategy exactly

Confirmed via grep: `bikeAccessory.service.ts` never imports `Queryuilder`. `getBikeAccessoriesFromDB` hand-rolls the same filter/sort/pagination/field logic *and* adds a grouping strategy spec 13 introduced: one `find()` per accessory status (in enum declared order: `pending`, `purchased`, `cancelled`, unless the client's own `?status=` filter narrows it to one), concatenated, then paginated in memory — specifically to get "grouped by status" ordering without a persisted rank field or a Mongo aggregation pipeline (this codebase's house style avoids `$group`, per `context/architecture.md`).

This **cannot** reuse `buildPrismaListQuery` wholesale (that helper does one query, not N grouped queries) — but it can reuse the *building blocks* (where-filter merge, orderBy parsing, `skip`/`take` math) inside its own loop:

```ts
const statusOrder = Object.values(AccessoryStatus);
const requestedStatuses = /* same logic as today, unchanged */;

const resultsByStatus = await Promise.all(
  requestedStatuses.map((status) =>
    prisma.bikeAccessory.findMany({
      where: { bikeId, isDeleted: false, ...filterQuery, status },
      orderBy, // same per-group sort as today
    }),
  ),
);
const result = resultsByStatus.flat().slice(skip, skip + limit).map(toApiShape);

const meta = await prisma.bikeAccessory.count({
  where: { bikeId, isDeleted: false, ...filterQuery, status: { in: requestedStatuses } },
});
```

Port this exactly — don't "simplify" it into a single query with `orderBy: [{ status: ... }, ...]`, since Postgres enum ordering isn't guaranteed to match the app's declared `pending`/`purchased`/`cancelled` order (alphabetical vs. declaration order can diverge) and this multi-query approach is what spec 13 deliberately chose to sidestep that.

### D2. The one-way "purchased" lock and `purchaseDate` stamping — pure business logic, untouched

`updateBikeAccessoryInDB`'s lock check (can't un-purchase) and the `justPurchased` detection (stamps `purchaseDate` exactly once, on the transition) are plain conditionals over already-fetched field values — no Mongoose-specific behavior, port verbatim into the Prisma version (fetch via `findFirst`, compute `justPurchased`/`updateData` the same way, then `prisma.bikeAccessory.update(...)`).

### D3. Decimal + FK-rename in `notifyExpenseTracker` calls

`price` is `Decimal(12,2)?` — both the create and update controller paths call `notifyExpenseTracker({..., amount: accessory.price!, ...})` only when `justPurchased`/status-is-purchased. Same rule as specs 33 §B/34 §A: the service's returned `accessory` must already be `toApiShape`'d (with `price` converted via `Number(...)`) before the controller reads `.price`/`._id` off it.

### D4. Known, accepted incoherence — `spending.service.ts` also reads `bikeAccessoryModel` directly

Adding to the list already started in specs 33 §G/34's out-of-scope note: `spending.service.ts` imports `bikeAccessoryModel` (not just `fuelLogModel`/`maintenanceLogModel`) for its "purchased accessories count as spending" aggregation. After this phase, accessories created via the new Prisma-backed endpoint won't show up in spending summaries until Phase 7. Not fixed here.

## `bikeDocument` — module-specific notes

- Same `files[]` synthesized-`_id` treatment as `bikeIssue.images[]` (§B), including `resourceType`/`originalName`/`mimeType` per item.
- `getBikeDocumentsFromDB` has its **own** third list-query variant, different from both `buildPrismaListQuery` and `bikeAccessory`'s status-grouping: when the client supplies no explicit `?sort=`, it runs two queries (`expiryDate` ascending for documents that have one, `-createdAt` for documents that don't) and concatenates them — "documents with an expiry first, soonest first; no-expiry documents last" isn't expressible as one ascending sort (Mongo/Postgres both treat `NULL`/missing as sorting first, not last, on ascending order). When the client *does* supply `?sort=`, it fully overrides this and goes through `Queryuilder` instead (this module **is** a `Queryuilder` consumer, confirmed via grep, unlike `bikeAccessory`). Port both branches:
  ```ts
  if (sanitizedQuery.sort) {
    const { where, orderBy, skip, take } = buildPrismaListQuery({
      baseWhere: { bikeId, isDeleted: false },
      query: sanitizedQuery,
      defaultSort: "-createdAt", // unused when query.sort is present, kept for signature consistency
    });
    // ordinary single findMany/count pair
  } else {
    const [withExpiry, withoutExpiry, meta] = await Promise.all([
      prisma.bikeDocument.findMany({ where: { ...baseWhere, expiryDate: { not: null } }, orderBy: { expiryDate: "asc" } }),
      prisma.bikeDocument.findMany({ where: { ...baseWhere, expiryDate: null }, orderBy: { createdAt: "desc" } }),
      prisma.bikeDocument.count({ where: baseWhere }),
    ]);
    const result = [...withExpiry, ...withoutExpiry].slice(skip, skip + limit).map(toApiShape);
  }
  ```
- Cleanup-on-delete (`Promise.all(document.files.map((file) => deleteCloudinaryImage(...)))`) is pure application logic over the JS array, unaffected by the DB swap — port as-is (still best-effort, still doesn't block the soft-delete itself on a Cloudinary failure).
- `uploadDocument`/`uploadDocumentBuffer` (memory-storage multer, distinct from `bikeIssue`'s `CloudinaryStorage`-backed `upload.ts`) — no DB involvement, untouched.

## `bikeManualChunk` — module-specific notes

### E. `bikeManual.service.ts`'s remaining Mongo usage — everything except the two `.save()` calls spec 32 §C already fixed

Recall spec 32 §C already patched `uploadBikeManualIntoDB`/`deleteBikeManualFromDB`'s `bike.manual = ...; await bike.save();` calls (necessary immediately, since `Bike` moved to Prisma in Phase 2). What's left for *this* phase is `bikeManualChunkModel` itself — `insertMany`, `deleteMany({ bike: bikeId })`, and the plain `.find({ bike: bikeId }).select(...).lean()` in `getRelevantManualChunksForChat`:

```ts
// replace case
if (bike.manual) {
  await deleteCloudinaryImage(bike.manual.publicId, "raw");
  await prisma.bikeManualChunk.deleteMany({ where: { bikeId } });
}
// ...
await prisma.bikeManualChunk.createMany({
  data: chunkTexts.map((chunkText, chunkIndex) => ({
    id: generateObjectId(),
    bikeId,
    chunkIndex,
    chunkText,
  })),
});
```
`getRelevantManualChunksForChat` → `prisma.bikeManualChunk.findMany({ where: { bikeId }, select: { chunkIndex: true, chunkText: true } })`, fed straight into `scoreAndRankChunks` from `bikeManual.utils.ts` — that file is pure in-process scoring logic (no DB, no Mongoose types beyond the `TBikeManualChunk` shape it's typed against), untouched by this migration; confirm its type still structurally matches whatever `bikeManual.interface.ts`'s post-rewrite chunk type looks like (field names `chunkIndex`/`chunkText` are identical between Mongoose and Prisma, so no change needed there either).

### D. `bikeManualChunk` never reaches an HTTP response

`getRelevantManualChunksForChat` is, per its own comment, "the only function `ai.service.ts` imports from this module" — its return value feeds an AI prompt string, never serialized as JSON to a client. No `_id`/`bike` remap needed anywhere in this file (§A doesn't apply here).

## Implementation

1. `bikeIssue.service.ts` — rewrite all 8 functions per §A–C, `bikeIssue`-specific notes.
2. `bikeAccessory.service.ts` — rewrite all 7 functions per §A, §C, §D1–D3.
3. `bikeDocument.service.ts` — rewrite all 7 functions per §A–C, `bikeDocument`-specific notes.
4. `bikeManual.service.ts` — remaining Mongo calls per §E (the two `.save()` sites are already done, per spec 32 §C).
5. Fix `buildPrismaListQuery`'s sort-string parsing (whitespace-or-comma split) — shared file from Phase 3, touched here per `bikeIssue`'s note above.
6. `bikeIssue.interface.ts` / `bikeAccessory.interface.ts` / `bikeDocument.interface.ts` / `bikeManual.interface.ts` — drop Mongoose `ObjectId` imports, `bike: ObjectId` → `bikeId: string` on create-payload types; `TBikeIssueImage`/`TBikeDocumentFile`'s `_id?: ObjectId` → `_id: string` (now always synthesized, not optional/DB-assigned).
7. Four `.model.ts` files — **do not delete** `bikeIssue.model.ts`/`bikeAccessory.model.ts`/`bikeDocument.model.ts`/`bikeManual.model.ts` if anything outside their own module still imports them; re-grep at implementation time (none found as of this spec's writing beyond `ai.service.ts`'s use of `bikeManualServices` — a service-layer import, not a model import, so that one's already fine after this phase).
8. Controllers/routes/validations for all four — expected no-op, verify only.

## Files touched

- `src/app/modules/bikeIssue/bikeIssue.service.ts`, `.interface.ts` (rewrite/trim)
- `src/app/modules/bikeAccessory/bikeAccessory.service.ts`, `.interface.ts` (rewrite/trim)
- `src/app/modules/bikeDocument/bikeDocument.service.ts`, `.interface.ts` (rewrite/trim)
- `src/app/modules/bikeManual/bikeManual.service.ts`, `.interface.ts` (remaining calls, trim)
- `src/app/builder/buildPrismaListQuery.ts` (bugfix — whitespace-splitting)
- Not touched: all four `.model.ts` files (kept pending re-grep), `spending.service.ts`/`ai.service.ts` (deferred to Phase 7, §D4 and prior specs' equivalents).

## Out of scope for this phase

- `errorLog` — Phase 6.
- `spending`, `ai`, `notification` — Phase 7.

## Dependencies

Phase 2 (spec 32) landed. Phase 3's `buildPrismaListQuery` (being bugfixed here, not rebuilt).

## Verify-when-done

- [ ] `yarn build` / `yarn lint` clean.
- [ ] `bikeIssue` full CRUD + status toggle + image add/delete against a Postgres-backed bike; deleting one image by id doesn't remove others; sort order (`status -dateReported`) matches pre-migration behavior exactly (regression-checks the §"bikeIssue" sort-string fix).
- [ ] `fuelLog`/`maintenanceLog` list endpoints (Phases 3/4, already using `buildPrismaListQuery`) still sort correctly after the whitespace-splitting fix — this is a shared-file change, re-run their existing verify checks too, not just `bikeIssue`'s.
- [ ] `bikeAccessory` full CRUD + image add/delete; list endpoint returns accessories grouped by status in declared enum order, matching pre-migration output for a bike with a mix of pending/purchased/cancelled accessories; purchase lock (can't un-purchase, can't re-stamp `purchaseDate`) still enforced.
- [ ] `bikeDocument` full CRUD + file add/delete (multi-file); list endpoint's default expiry-first-then-no-expiry ordering matches pre-migration behavior; explicit `?sort=` override still works.
- [ ] Bike manual upload/replace/delete/chat-retrieval end-to-end against a Postgres-backed bike — chunks actually persist and are retrievable (this exercises both spec 32 §C's earlier fix and this phase's `bikeManualChunkModel`→Prisma rewrite together).
- [ ] Confirmed via manual check: all four `.model.ts` files' deletion status matches what the re-grep at implementation time actually found (recorded in the PR/commit, not assumed from this spec).
