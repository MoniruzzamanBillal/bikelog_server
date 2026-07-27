# Image/File Upload (Cloudinary), linked to existing schemas

Status: ✅ Complete

## Goal

Add Cloudinary-backed image upload, linked to specific existing records: a receipt photo on `fuelLog`, a service/invoice photo on `maintenanceLog`, a product photo on `bikeAccessory`, and one-or-more evidence photos on `bikeIssue`. Not on `bike` itself (explicitly out of scope per product decision). The app is in production, so every schema change here must be additive/optional — no migration, no backfill, existing documents stay valid untouched.

## Existing scaffolding (reuse, don't blindly copy)

`cloudinary`, `multer`, and `multer-storage-cloudinary` are already installed (see `package.json`), and `src/app/config/index.ts` already has `cloudinary_cloud_name` / `cloudinary_api_key` / `cloudinary_api_secret` reading `CLOUDINARY_*` env vars. There is also an uncommitted, not-yet-wired `src/app/util/SendImageCloudinary.ts` that calls `cloudinary.config()` and builds a multer `CloudinaryStorage` instance — modeled on the same pattern used in the user's other project (`lms_server`).

**Don't copy that reference pattern as-is** — it has real bugs worth fixing here instead of inheriting:
- It uploads every file to Cloudinary **twice**: once automatically via multer's `CloudinaryStorage` storage engine, then *again* via a manual `cloudinary.uploader.upload()` call on the same `req.file.path` inside the service layer. Only the storage-engine upload is needed — `CloudinaryStorage` already sets `req.file.path` to the `secure_url` and `req.file.filename` to the `public_id` by the time multer middleware finishes. Drop the manual re-upload entirely.
- It swallows upload errors with `console.log` and returns `undefined` — no `AppError`, no propagation. Anything wrapping Cloudinary calls here should follow this codebase's throw-`AppError`-let-`catchAsync`-handle-it convention instead.
- It never persists `public_id`, so a replaced/deleted image's old Cloudinary asset can never be cleaned up — it just gets orphaned. This spec stores `{ url, publicId }` (not a bare string) specifically so old assets *can* be deleted via `cloudinary.uploader.destroy()`.

Given none of this is committed yet, `src/app/util/SendImageCloudinary.ts` should be deleted and replaced by the two files below rather than patched in place.

## Design

### 1. Shared upload plumbing

- **`src/app/util/cloudinary.ts`** (new) — calls `cloudinary.config(...)` once from `config.cloudinary_*`, exports the configured `cloudinary` instance and `deleteCloudinaryImage(publicId: string): Promise<void>`, a best-effort wrapper around `cloudinary.uploader.destroy()` that catches and logs rather than throwing — a failed cleanup shouldn't block the user's actual delete/replace action.
- **`src/app/middleware/upload.ts`** (new, same folder as existing `authCheck.ts` / `validateRequest.ts`) — builds a `CloudinaryStorage` off the `cloudinary` instance above, with an image-only `fileFilter` and a size limit (e.g. 5MB), and exports `upload` (the multer instance). This is the single choke point every route below uses — no second upload mechanism anywhere else.
- **`src/app/interface/image.interface.ts`** (new) — `export type TCloudinaryImage = { url: string; publicId: string };`, reused by the four modules' interfaces below. The Mongoose subdocument shape itself (`{ url: String, publicId: String }`) is small enough to repeat literally in each `.model.ts` rather than force a shared schema abstraction across modules.

### 2. Schema additions — all optional, all additive

- `fuelLog` (`fuelLog.interface.ts` / `.model.ts`): `receiptImage?: TCloudinaryImage`, subdocument with `{ _id: false }`.
- `maintenanceLog`: `serviceImage?: TCloudinaryImage`, `{ _id: false }`.
- `bikeAccessory`: `productImage?: TCloudinaryImage`, `{ _id: false }`.
- `bikeIssue`: `images?: TCloudinaryImage[]` — default array-of-subdocuments behavior, so each entry keeps its own auto-generated `_id` (used below to target one image for deletion out of several).

No `required`, no `default` on any of these — existing documents remain valid with the field simply absent.

### 3. New routes — deliberately *not* folded into the existing create/update JSON endpoints

Mixing multipart file uploads into the existing Zod-validated JSON create/update flows (`POST /bikes/:bikeId/fuel-logs`, etc.) would force every existing numeric field through string-coercion handling and touch already-working production code paths for no real benefit. Instead, each module gets small dedicated image sub-routes, the same way `bikeIssue.route.ts` already has a dedicated `/:id/status` sub-route alongside its CRUD routes.

For `fuelLog`, `maintenanceLog`, `bikeAccessory` (single image each):
- `PUT /bikes/:bikeId/<resource>/:id/image` — `authCheck`, `upload.single("image")`, controller → service. Service: `findOwnedBikeOrThrow(bikeId, userId)`, load the record scoped to `bike` + `isDeleted: false`; if it already has an image, best-effort `deleteCloudinaryImage(old.publicId)`; then set `{ url: req.file.path, publicId: req.file.filename }` and save.
- `DELETE /bikes/:bikeId/<resource>/:id/image` — `authCheck`, controller → service. Same ownership/lookup, `deleteCloudinaryImage(existing.publicId)`, unset the field, save.

For `bikeIssue` (multiple images):
- `POST /bikes/:bikeId/issues/:id/images` — `authCheck`, `upload.array("images", 5)`, controller → service. Ownership + lookup, `$push` each uploaded file's `{ url, publicId }` into `images`, save.
- `DELETE /bikes/:bikeId/issues/:id/images/:imageId` — `authCheck`, controller → service. Ownership + lookup, find the subdocument whose `_id === imageId`, `deleteCloudinaryImage(that.publicId)`, `$pull` it out, save.

Every new controller function uses the existing `catchAsync` + `sendResponse(res, { status, success, message, data })` pattern (`status`, not `statusCode`). Every new service function reuses `findOwnedBikeOrThrow` from `bike.utils.ts` — no new ownership-check logic anywhere. No change to `src/app/router/index.ts`: these are new routes inside already-registered `.route.ts` files, not new top-level modules.

## Implementation

1. [x] Delete uncommitted `src/app/util/SendImageCloudinary.ts`.
2. [x] New `src/app/util/cloudinary.ts` — `cloudinary.config()`, exported `cloudinary` instance, `deleteCloudinaryImage(publicId)`.
3. [x] New `src/app/middleware/upload.ts` — `CloudinaryStorage` + image `fileFilter` + size limit, exported `upload` multer instance.
4. [x] New `src/app/interface/image.interface.ts` — `TCloudinaryImage`.
5. [x] `fuelLog.interface.ts` / `.model.ts` — add `receiptImage?: TCloudinaryImage`.
6. [x] `fuelLog.route.ts` / `.controller.ts` / `.service.ts` — add `PUT`/`DELETE .../:id/image`.
7. [x] `maintenanceLog.interface.ts` / `.model.ts` — add `serviceImage?: TCloudinaryImage`.
8. [x] `maintenanceLog.route.ts` / `.controller.ts` / `.service.ts` — add `PUT`/`DELETE .../:id/image`.
9. [x] `bikeAccessory.interface.ts` / `.model.ts` — add `productImage?: TCloudinaryImage`.
10. [x] `bikeAccessory.route.ts` / `.controller.ts` / `.service.ts` — add `PUT`/`DELETE .../:id/image`.
11. [x] `bikeIssue.interface.ts` / `.model.ts` — add `images?: TCloudinaryImage[]`.
12. [x] `bikeIssue.route.ts` / `.controller.ts` / `.service.ts` — add `POST .../:id/images` and `DELETE .../:id/images/:imageId`.
13. [x] Add the new requests to `postman/bikelog-api.postman_collection.json` (`multipart/form-data`), plus a short note in `postman/dummy-data.md`.

## Dependencies

No new npm packages — `cloudinary`, `multer`, `multer-storage-cloudinary`, and the `cloudinary_*` config keys were already installed/present. Requires real `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` values in `.env` to exercise any endpoint live (confirmed present).

**Discovered during implementation, not anticipated by this design**: `@types/multer` declares `"@types/express": "*"`, which yarn classic resolved to a separate `@types/express@5.0.6` nested under `node_modules/@types/multer/node_modules/`, distinct from the project's own `@types/express@4.17.25`. This broke `yarn build` across every route file touched by this spec (Express-4- vs Express-5-typed handlers in the same `router.delete(...)` call confuses overload resolution for the whole call, not just the mismatched argument) — fixed with a `"resolutions": { "@types/express": "^4.17.21" }` pin in `package.json` + `yarn install`. Necessary to satisfy this spec's own "clean build" requirement, not optional/out-of-scope cleanup.

## Verify-when-done

- [x] `yarn build` / `yarn lint` clean — same 4 pre-existing repo-wide lint errors, no new ones (one new `no-console` warning in `cloudinary.ts`, consistent with the existing warning-tolerated pattern elsewhere).
- [x] Upload a receipt image to a fuel log; `GET` shows `receiptImage.url`/`publicId`.
- [x] Re-upload to the same fuel log; old Cloudinary asset is destroyed (verified via direct HTTP request to the old Cloudinary URL, now 404), field is replaced not duplicated.
- [x] `DELETE` the image; field is unset and the asset is removed from Cloudinary.
- [x] Repeat upload/replace/delete for maintenance log (`serviceImage`) and bike accessory (`productImage`).
- [x] `POST` 2-3 images to a bike issue; all appear in `images` with distinct `_id`s. `DELETE` one by `imageId`; only that one is removed from both the array and Cloudinary (verified: 3 added, middle one deleted by id, remaining 2 untouched, deleted one's Cloudinary URL now 404s).
- [x] All new endpoints 403/404 when attempted against a bike/record owned by a different user, matching existing `findOwnedBikeOrThrow` behavior — verified against a second real throwaway user/bike for every new route (all returned 404).
- [x] A non-image file upload attempt is rejected by `fileFilter` before ever reaching Cloudinary — verified a `.txt` upload gets a clean `400`, not `500`.

Verified live against a temporary local server instance and throwaway fixtures (2 users, 2 bikes, 1 fuel log, 1 maintenance log, 1 maintenance type, 1 accessory, 1 issue) — all fully cleaned up afterward (throwaway users/bikes hard-deleted directly since no user-delete API exists; every other record and uploaded image removed through the app's own delete endpoints first so Cloudinary assets were actually destroyed, not just detached). See `context/progress-tracker.md`'s 2026-07-27 entry for full detail.
