# 38: Update Endpoint for Maintenance Type and Engine Oil Type

## Status

✅ Complete — implemented and verified 2026-09-17. See `progress-tracker.md` Recent Activity for the full verification pass.

## Goal

Per direct user request: both catalog modules (`maintenanceType`, `engineOilType`) currently only support `POST` (create) and `GET` (list) — there is no way to correct a typo or change an interval on an existing entry without deleting and recreating it (which would also orphan any `maintenanceLog` rows already pointing at that type's `id` via FK). Add a `PATCH /:id` update endpoint to each module, following this codebase's existing update conventions exactly (see `bike` module).

## Context

- Both models are global catalogs, not per-user/per-bike data — no `ownerId`/FK-to-`user` on either (`prisma/schema.prisma:80-103`). Any authenticated user can already create an entry (`authCheck` only, no role check); the update endpoint follows the same authorization level — `authCheck` only, no ownership check (there is no owner to check against).
- Both `name` fields are `@unique` in Postgres. `createMaintenanceTypeIntoDB`/`createEngineOilTypeIntoDB` already catch Prisma's `P2002` (unique-constraint violation) and rethrow as `AppError(409, ...)` — the new update functions must do the same for a rename that collides with another existing row.
- Existence check pattern: this codebase's established convention for "does this row exist" before a mutating operation is a `findFirst`/`findUnique` read-then-404 (see `bike.utils.ts`'s `findOwnedBikeOrThrow`), not catching Prisma's `P2025` (record-to-update-not-found) — `P2025` isn't handled anywhere in `globalErrorHandler.ts` today, so introducing it now would be a one-off. New `updateMaintenanceTypeInDB`/`updateEngineOilTypeInDB` will `findUnique` by `id` first, throw `AppError(404, ...)` if absent, then `update`.
- `defaultIntervalKm`/`defaultIntervalDays` on `MaintenanceType` are nullable (`Int?`) — the update schema keeps `.nullable().optional()` (same as create) so a client can explicitly clear one back to `null`, not just set a new value. `suggestedIntervalKm` on `EngineOilType` is non-nullable (`Float`) — update schema keeps it required-if-present (`.positive().optional()`, no `.nullable()`), matching the create schema's own constraint.
- No `DELETE` endpoint is in scope — the user asked specifically for update functionality; deleting a catalog entry that's already referenced by `maintenanceLog.maintenanceType`/`.oilType` FKs is a separate, unasked-for design question (cascade? restrict?) and stays out of this spec.
- Response shape: both `create`/`get` already remap Prisma's `id` → `_id` (`{ ...result, _id: result.id }`) for client compatibility — the update response must do the same.

## Design

### `maintenanceType` module

- `maintenanceType.validation.ts` — add `updateMaintenanceTypeSchema`:
  ```ts
  const updateMaintenanceTypeSchema = z.object({
    body: z.object({
      name: z.string().optional(),
      defaultIntervalKm: z.number().positive().nullable().optional(),
      defaultIntervalDays: z.number().positive().nullable().optional(),
    }),
  });
  ```
- `maintenanceType.service.ts` — add:
  ```ts
  const updateMaintenanceTypeInDB = async (
    id: string,
    payload: Partial<TMaintenanceType>,
  ) => {
    const existing = await prisma.maintenanceType.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError(httpStatus.NOT_FOUND, "Maintenance type not found");
    }
    try {
      const result = await prisma.maintenanceType.update({
        where: { id },
        data: {
          name: payload.name,
          defaultIntervalKm: payload.defaultIntervalKm,
          defaultIntervalDays: payload.defaultIntervalDays,
        },
      });
      return { ...result, _id: result.id };
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new AppError(
          httpStatus.CONFLICT,
          "A maintenance type with this name already exists",
        );
      }
      throw error;
    }
  };
  ```
  (Prisma's `update({ data })` skips any key whose value is `undefined`, so an omitted field in the request body is left untouched — this is what makes the `Partial<TMaintenanceType>` passthrough a correct partial update without extra branching.)
- `maintenanceType.controller.ts` — add `updateMaintenanceType`, mirroring `createMaintenanceType`'s `catchAsync`/`sendResponse` shape, message `"Maintenance type updated successfully"`, status `200`.
- `maintenanceType.route.ts` — add, after the existing `GET "/"`:
  ```ts
  router.patch(
    "/:id",
    authCheck,
    validateRequest(maintenanceTypeValidations.updateMaintenanceTypeSchema),
    maintenanceTypeController.updateMaintenanceType,
  );
  ```

### `engineOilType` module

Same shape, mirrored exactly:

- `updateEngineOilTypeSchema`: `name: z.string().optional()`, `suggestedIntervalKm: z.number().positive().optional()` (no `.nullable()` — field is non-nullable in the schema).
- `updateEngineOilTypeInDB(id, payload)`: same `findUnique` → 404 → `update` → catch `P2002` → 409 ("An engine oil type with this name already exists") shape.
- `updateEngineOilType` controller: message `"Engine oil type updated successfully"`.
- `PATCH /:id` route, same placement/middleware order.

### Postman collection

Add "Update Maintenance Type" (`PATCH {{baseUrl}}/maintenance-types/{{maintenanceTypeId}}`) and "Update Engine Oil Type" (`PATCH {{baseUrl}}/engine-oil-types/{{engineOilTypeId}}`) requests to their respective existing folders, reusing the already-captured `maintenanceTypeId`/`engineOilTypeId` collection variables (set by the existing "Create..." requests' test scripts) — same JSON body/header/test-script shape as the existing "Update Maintenance Log" request.

## Implementation

1. ✅ `maintenanceType.validation.ts` — added `updateMaintenanceTypeSchema`, exported it.
2. ✅ `maintenanceType.service.ts` — added `updateMaintenanceTypeInDB`, exported it.
3. ✅ `maintenanceType.controller.ts` — added `updateMaintenanceType`, exported it.
4. ✅ `maintenanceType.route.ts` — wired `PATCH /:id`.
5. ✅ `engineOilType.validation.ts` — added `updateEngineOilTypeSchema`, exported it.
6. ✅ `engineOilType.service.ts` — added `updateEngineOilTypeInDB`, exported it.
7. ✅ `engineOilType.controller.ts` — added `updateEngineOilType`, exported it.
8. ✅ `engineOilType.route.ts` — wired `PATCH /:id`.
9. ✅ `postman/bikelog-api.postman_collection.json` — added both "Update..." requests.
10. ✅ `yarn build` + `yarn lint` clean (0 errors, same pre-existing warning baseline).
11. ✅ Manual verification against a running local server (port 5099) + real Neon Postgres (see Verify).
12. ✅ `context/progress-tracker.md` — row flipped to Complete, Recent Activity entry added.

## Verify

- [x] `PATCH /maintenance-types/:id` with a partial body (e.g. just `defaultIntervalKm`) updates only that field, leaves `name`/other fields untouched.
- [x] `PATCH /maintenance-types/:id` with `defaultIntervalKm: null` clears a previously-set interval back to `null`.
- [x] `PATCH /maintenance-types/:id` renaming to a name that collides with a different existing row → `409`, original row unchanged.
- [x] `PATCH /maintenance-types/:id` with a non-existent id → `404`.
- [x] Same four checks repeated for `PATCH /engine-oil-types/:id`.
- [x] No auth token → `401` on both new routes.
- [x] `yarn build` clean, `yarn lint` shows no new errors/warnings beyond the existing baseline.
