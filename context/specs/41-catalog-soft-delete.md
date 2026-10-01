# 41: Soft-delete for maintenance types & engine oil types

Status: ⛔ Not Started — plan only, written 2026-10-01 per direct user request. **No code written yet.**

Backend half of a three-repo feature. Clients: `bikelog_app/ai context/specs/45-catalog-soft-delete.md` (primary consumer), `bikelog_client-web-/context/specs/28-catalog-soft-delete.md` (parity, not yet written). **Build this spec first** — both clients depend on it.

## Readiness check (2026-10-01)

Verified directly against `prisma/schema.prisma` and both route files. Nothing for this feature exists yet:

| Needed                           | State                                                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `isDeleted` on `MaintenanceType` | **absent** — `id`, `name @unique`, `defaultIntervalKm Int?`, `defaultIntervalDays Int?`, `createdAt`, `updatedAt` |
| `isDeleted` on `EngineOilType`   | **absent** — `id`, `name @unique`, `suggestedIntervalKm Float`, `createdAt`, `updatedAt`                          |
| `DELETE` route                   | **absent** — both routers expose only `POST /`, `GET /`, `PATCH /:id` (spec 38)                                   |
| Delete service fn                | **absent** — both services export only create/get/update                                                          |
| Migration                        | only `20260914050701_init`                                                                                        |

Nothing blocks it: soft delete already exists on 8 other models, both services already throw a 409 `AppError` on `P2002`, `MaintenanceLog` already carries both FKs (`maintenanceTypeId` required, `oilTypeId` nullable), and spec 38's PATCH endpoints give the skeleton to extend.

---

## Goal

Add soft delete to both shared catalogs: a new `isDeleted` boolean, a `DELETE /:id` endpoint on each that flips it, and a referential guard that refuses with a `409` and a human-readable message when a live maintenance log still references the entry. Rows are never removed from Postgres.

---

## Design

### Decisions (confirmed by the user, 2026-10-01)

1. **List endpoints hide soft-deleted rows** — `GET /maintenance-types` and `GET /engine-oil-types` filter `isDeleted: false`.
2. **Only live logs block a delete** — count maintenance logs with `isDeleted: false`. A type whose only referencing logs are themselves soft-deleted _is_ deletable. No integrity risk: the catalog row is never removed, so the FK stays valid regardless.
3. **Re-adding a soft-deleted name revives that row** rather than erroring or inserting a duplicate.

### The consequence of decision 1, and why §B exists

Decision 1 cannot ship on its own. `GET /maintenance-logs` currently returns `maintenanceType` as a bare **id string** (`maintenanceLog.service.ts:27`), and every client resolves the display name by looking that id up in the separately-fetched catalog list, falling back to the literal word `"Maintenance"`:

```ts
// bikelog_app/components/main/MaintenanceLog/MaintenanceLogCard.tsx:37
maintenanceTypes.find((t) => t?._id === typeId)?.name ?? "Maintenance";
```

Hide the row from that list and **every historical log which used it silently relabels to "Maintenance"** — the user's own past data appears to change. `RemindersBanner.tsx:69` does the same.

So this spec removes the client-side join instead: **the server populates the type name onto log reads** (§B). Both clients already accept that shape — a legacy Mongoose-populate branch survives in four places, reading `.name` on the cards and extracting `._id` for the edit-form picker value:

- `bikelog_app/.../MaintenanceLogCard.tsx:32`, `MaintenanceLogFormModal.tsx:94-102`
- `bikelog_client-web-/.../MaintenanceLogCard.tsx:23`, `MaintenanceLogFormModal.tsx:80,85`

That makes §B near-invisible to the clients and turns decision 1 into the better architecture: the fragile join disappears, and both clients' pickers and settings tables become correct with **zero client-side filtering**.

§C is a bonus from the same change: it closes a gap `context/progress-tracker.md` already lists as Known — `TReminder.maintenanceType` returns a bare id where the client type declares `{ _id, name }` (flagged in spec 34 §E and deliberately left unfixed then).

### Conventions this follows

- Soft delete is **explicit** post-migration: Prisma has no `pre("find")` hook, so every read must carry its own `isDeleted: false`. Same discipline as `bike`, `fuelLog`, `maintenanceLog`.
- Ids stay application-generated (`generateObjectId()`); reviving a row preserves its id, which is what keeps historical logs labelled.
- Errors are `AppError(status, message)` left to `globalErrorHandler`; responses go through `sendResponse` with the `status` key.
- `P2002` is caught service-locally, as the existing create/update already do.

---

## Implementation

### A. Schema + migration

Add to **both** `MaintenanceType` and `EngineOilType` in `prisma/schema.prisma`:

```prisma
  isDeleted           Boolean  @default(false)
```

`@default(false)` backfills every existing row, so there is no data migration to write. Generate with:

```bash
npx prisma migrate dev --name add_catalog_soft_delete
```

⚠️ Needs **`DATABASE_URL_UNPOOLED`** — `prisma.config.ts` points the migration engine at the direct Neon URL, not the pooled `DATABASE_URL` the runtime client uses. See `ENV_SETUP.md`.

### B. Populate type names on maintenance-log reads — do before §D

`src/app/modules/maintenanceLog/maintenanceLog.service.ts`. Add to **every** read that returns logs (`getMaintenanceLogsFromDB`, the single-log read, and any other `findMany`/`findFirst` returning logs):

```ts
include: {
  maintenanceType: { select: { id: true, name: true } },
  oilType:         { select: { id: true, name: true } },
}
```

Then change the row mapper (~line 27) from `maintenanceType: log.maintenanceTypeId` to the shape the clients already handle, taking care the raw relation object is not leaked through the `...log` spread:

```ts
maintenanceType: log.maintenanceType
  ? { _id: log.maintenanceType.id, name: log.maintenanceType.name }
  : log.maintenanceTypeId,
oilType: log.oilType
  ? { _id: log.oilType.id, name: log.oilType.name }
  : log.oilTypeId ?? undefined,
```

The `include` must carry **no** `isDeleted` filter — a log has to resolve the name of a type that was since deleted. That is the whole purpose of this section.

Update `TMaintenanceLog`'s returned-row type accordingly.

### C. Populate the reminders endpoint

`getRemindersFromDB` in the same file emits `maintenanceType: log.maintenanceTypeId` with a comment noting the shape mismatch is pre-existing. Add the same `include` to its `findMany` and emit `{ _id, name }`. Update `TReminder`, and drop the now-stale comment. Closes the Known Gap noted above and keeps `RemindersBanner` correct for deleted types.

### D. Hide deleted rows from the list endpoints

`getMaintenanceTypesFromDB` and `getEngineOilTypesFromDB`:

```ts
const result = await prisma.maintenanceType.findMany({
  where: { isDeleted: false },
  orderBy: { name: "asc" },
});
```

**Do not land this before §B and §C.** On its own it is the regression described in Design.

### E. Delete service function

`maintenanceType.service.ts`:

```ts
const deleteMaintenanceTypeFromDB = async (id: string) => {
  const existing = await prisma.maintenanceType.findUnique({ where: { id } });
  if (!existing || existing.isDeleted) {
    throw new AppError(httpStatus.NOT_FOUND, "Maintenance type not found");
  }

  // ! Decision 2: only live logs block a delete. A soft-deleted log does not —
  // ! otherwise a type used even once could never be removed. Safe either way,
  // ! since this row is never actually deleted and the FK stays valid.
  const inUse = await prisma.maintenanceLog.count({
    where: { maintenanceTypeId: id, isDeleted: false },
  });

  if (inUse > 0) {
    throw new AppError(
      httpStatus.CONFLICT,
      `"${existing.name}" is used by ${inUse} maintenance log${inUse === 1 ? "" : "s"} and can't be deleted. Remove or re-assign ${inUse === 1 ? "it" : "them"} first.`,
    );
  }

  const result = await prisma.maintenanceType.update({
    where: { id },
    data: { isDeleted: true },
  });
  return { ...result, _id: result.id };
};
```

This message is **user-facing copy** — the app shows it verbatim in a warning toast, so it must read as a sentence, name the type, and say what to do next.

### F. Revive-on-recreate (decision 3)

`name` is `@unique` on both models, so without this a user who deletes "Insurance" and re-adds it gets _"A maintenance type with this name already exists"_ about a row they can no longer see. In `createMaintenanceTypeIntoDB`, before the `create`:

```ts
const softDeleted = await prisma.maintenanceType.findFirst({
  where: { name: payload.name as string, isDeleted: true },
});

if (softDeleted) {
  // ! Reuse the row instead of inserting a second one: `name` is @unique, and keeping
  // ! the original id means historical logs referencing it stay correctly labelled.
  const result = await prisma.maintenanceType.update({
    where: { id: softDeleted.id },
    data: {
      isDeleted: false,
      defaultIntervalKm: payload.defaultIntervalKm,
      defaultIntervalDays: payload.defaultIntervalDays,
    },
  });
  return { ...result, _id: result.id };
}
```

Keep the existing `P2002` catch — it must still fire when the clashing name belongs to a **live** row.

### G. Guard the remaining write paths

- `updateMaintenanceTypeInDB` / `updateEngineOilTypeInDB`: 404 when `!existing || existing.isDeleted`.
- `maintenanceLog.service.ts`, the four catalog existence checks (~lines 43, 51, 150, 159): must reject soft-deleted rows so new logs cannot reference a deleted type:

```ts
const maintenanceType = await prisma.maintenanceType.findFirst({
  where: { id: payload.maintenanceType, isDeleted: false },
});
```

⚠️ These are `findUnique` today and **must become `findFirst`** — `findUnique` only accepts unique fields in its `where`, so adding `isDeleted` to it will not compile.

### H. Route + controller

`maintenanceType.route.ts`:

```ts
// ! for soft-deleting a maintenance type
router.delete(
  "/:id",
  authCheck,
  maintenanceTypeController.deleteMaintenanceType,
);
```

No `validateRequest` — there is no body. Controller mirrors `updateMaintenanceType`: `httpStatus.OK`, message `"Maintenance type deleted successfully"`. Export the new service fn from `maintenanceTypeServices` and the handler from `maintenanceTypeController`.

### I. The same guard for `engineOilType` — spelled out, not just "repeat E–H"

`engineOilType.service.ts` gets the mirror of §E. The scenario this protects is the one the user described directly: create an oil type, use it on a maintenance log, then try to delete it — the delete must be refused.

```ts
const deleteEngineOilTypeFromDB = async (id: string) => {
  const existing = await prisma.engineOilType.findUnique({ where: { id } });
  if (!existing || existing.isDeleted) {
    throw new AppError(httpStatus.NOT_FOUND, "Engine oil type not found");
  }

  // ! Same rule as §E: only live logs block. MaintenanceLog.oilTypeId is nullable
  // ! (String?), so a log that recorded no oil type simply never matches here —
  // ! `count` handles that for free, no null-guard needed.
  const inUse = await prisma.maintenanceLog.count({
    where: { oilTypeId: id, isDeleted: false },
  });

  if (inUse > 0) {
    throw new AppError(
      httpStatus.CONFLICT,
      `"${existing.name}" is used by ${inUse} maintenance log${inUse === 1 ? "" : "s"} and can't be deleted. Remove or re-assign ${inUse === 1 ? "it" : "them"} first.`,
    );
  }

  const result = await prisma.engineOilType.update({
    where: { id },
    data: { isDeleted: true },
  });
  return { ...result, _id: result.id };
};
```

Then, exactly as §F–§H for the maintenance catalog:

- **Revive-on-recreate** in `createEngineOilTypeIntoDB` — `findFirst({ where: { name, isDeleted: true } })`, and on a hit `update` it back to `isDeleted: false` with the new `suggestedIntervalKm`. Keep the existing `P2002` catch for live-name clashes.
- **Guard `updateEngineOilTypeInDB`** — 404 on an already-deleted id.
- **Route** — `router.delete("/:id", authCheck, engineOilTypeController.deleteEngineOilType);`, no `validateRequest`. Controller returns `httpStatus.OK` with `"Engine oil type deleted successfully"`.

`oilTypeId` is the **only** reference to `EngineOilType` anywhere in the schema (verified by grep), so this one count is a complete in-use check. Same for `maintenanceTypeId` and `MaintenanceType`.

### End-to-end: the two flows this feature must get right

**Flow 1 — engine oil type in use (the user's stated scenario)**

1. User creates oil type _"Motul 7100"_ → `POST /api/engine-oil-types` → `200`.
2. User logs a service on the maintenance page selecting it → `POST /api/bikes/:bikeId/maintenance-logs` with `oilType: "<id>"` → the log row stores `oilTypeId`.
3. User opens Settings and taps delete on _"Motul 7100"_ → `DELETE /api/engine-oil-types/<id>`.
4. Service counts live logs → `1` → throws `AppError(409, '"Motul 7100" is used by 1 maintenance log and can\'t be deleted. Remove or re-assign it first.')`.
5. `globalErrorHandler` serialises it as `{ success: false, message: "<that sentence>", ... }` with HTTP `409`.
6. The app surfaces that `message` verbatim in a warning toast; the row stays in the table. See spec 45 §B.
7. If the user then deletes that maintenance log and retries, the count is `0` and the delete succeeds.

**Flow 2 — maintenance type in use**

Identical, counting `maintenanceTypeId`. Note the asymmetry: `maintenanceTypeId` is **required** on every maintenance log, so any log at all pins its type, whereas an oil type is only pinned by logs that actually recorded one.

**What must NOT happen in either flow:** a raw Prisma `P2003` foreign-key error reaching the client as a generic `500`. That is precisely why the count runs _before_ the update, and why §G converts the catalog existence checks to `findFirst` with `isDeleted: false` — a deleted catalog row must be unreachable to new writes rather than failing at the database layer. `globalErrorHandler` has no `P2003` branch (its only Prisma-era handling is service-local `P2002`), so an unguarded FK violation would surface as "Something went wrong".

### J. Postman

Add both `DELETE` requests to `postman/bikelog-api.postman_collection.json`, including a saved `409` example response. Postman is this repo's manual-testing tool of record.

### Files touched

`prisma/schema.prisma` · one new `prisma/migrations/<ts>_add_catalog_soft_delete/` · `maintenanceType.{service,controller,route}.ts` · `engineOilType.{service,controller,route}.ts` · `maintenanceLog.service.ts` + its `TMaintenanceLog`/`TReminder` types · `postman/bikelog-api.postman_collection.json`

---

## Dependencies

**No new packages.** Everything required is already installed and in use:

| Need                                              | Already available                 |
| ------------------------------------------------- | --------------------------------- |
| Soft-delete column + migration                    | Prisma 7 (`prisma migrate`)       |
| 409 conflict error                                | `AppError` + `globalErrorHandler` |
| Controller plumbing                               | `catchAsync`, `sendResponse`      |
| Auth                                              | `authCheck`                       |
| Id generation (revive path reuses an existing id) | `generateObjectId`                |

One generated artifact: the migration directory.

---

## Verify

`yarn build` and `yarn lint` clean — no _new_ errors; ~5 pre-existing ones outside Bike Log modules are expected. Then, via Postman against a Neon branch (**not** local Postgres — the `PrismaNeon` adapter needs a real Neon host):

**Schema**

- [ ] Migration applies cleanly; every pre-existing catalog row reads `isDeleted: false`.

**Delete + guard**

- [ ] `DELETE /api/maintenance-types/:id` on an unused type → `200`; row still present in Postgres with `isDeleted: true`.
- [ ] `DELETE` on a type used by a **live** log → `409` with the exact sentence from §E, and the row is still `isDeleted: false`.
- [ ] `DELETE` on a type whose only referencing logs are **soft-deleted** → `200` (proves decision 2).
- [ ] `DELETE` the same id twice → second call `404`.
- [ ] `PATCH` a soft-deleted type → `404` (§G).
- [ ] `POST /api/bikes/:bikeId/maintenance-logs` referencing a soft-deleted type → rejected, not a `P2003` 500 (§G).

**Reads — the regression guards**

- [ ] `GET /api/maintenance-types` omits the deleted row (decision 1).
- [ ] **`GET /api/bikes/:bikeId/maintenance-logs` for a log that used the deleted type still returns its real name** in `maintenanceType.name`. This is the single most important check in this spec — it proves §B protects historical display.
- [ ] `GET /api/bikes/:bikeId/reminders` returns `maintenanceType` as `{ _id, name }`, including for a deleted type (§C).
- [ ] An un-deleted type's logs and reminders are unchanged in shape and content.

**Revive**

- [ ] `POST` a type whose name matches a soft-deleted row → `200`, the **same id** comes back revived, and no second row exists (decision 3).
- [ ] `POST` a name matching a **live** row → still `409` "already exists".

**Oil types — the user's stated scenario, walked end to end**

- [ ] Create an oil type, log a maintenance record that selects it, then `DELETE` that oil type → `409`, message names the oil type and the log count, row still `isDeleted: false`.
- [ ] Delete that maintenance log, retry the oil-type delete → now `200`.
- [ ] A maintenance log with `oilTypeId: null` does **not** block deleting any oil type.
- [ ] Repeat every other item above for `engine-oil-types`, counting against `oilTypeId`.
- [ ] Confirm no flow can produce a raw `P2003` / generic `500` — the guard must always fire first.

**Seeds**

- [ ] `yarn seed:maintenance-types` after soft-deleting a seed type → the type stays deleted. `upsert({ where: { name }, update: {} })` already guarantees this; verified by reading the script, no change needed. If re-seeding _should_ restore defaults, that is a deliberate extra and is **not** in this spec.

## Follow-on client work

Neither client can be finished until this ships. After §B/§C/§D land, both clients need **no filtering changes** — only the delete button, confirm dialog and warning toast. See `bikelog_app`'s spec 45 for the app side, which also records two pre-existing app bugs this feature runs into (errors toast twice; the error body has no `statusCode`, so the app's `errorObj.statusCode` is always `500`).
