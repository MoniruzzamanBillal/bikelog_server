# Bike Documents/Papers (Cloudinary, mixed image+PDF, multi-file)

Status: ✅ Complete

## Goal

Add a new `bikeDocument` resource for storing scanned/photographed bike paperwork — registration paper, tax token, purchase paper, driving license, bank receipt, or anything else the user wants to track — with an optional expiry date (e.g. registration paper expiring 2028-07-27, driving license expiring 2036). Follows the same two-step UX already established for `bikeIssue`: the user first creates the record (title, optional description, optional expiry date) via a JSON `POST`, then separately attaches one or more files to that record via a dedicated multipart sub-route. Unlike `bikeIssue.images[]`, files here may be **images or PDFs, mixed, multiple per record**.

## Existing scaffolding (reuse, don't blindly copy)

- `src/app/util/cloudinary.ts` already has `cloudinary.config()`, `deleteCloudinaryImage(publicId, resourceType: "image" | "raw" = "image")`, and `uploadRawBuffer(buffer, originalName)` (hardcoded `resource_type: "raw"`, used today only by `bikeManual`'s single-PDF flow). `deleteCloudinaryImage` already accepts a `resourceType` param — it was built with mixed-type deletion in mind even though no caller passes `"raw"` yet.
- `src/app/middleware/upload.ts` (image-only, `CloudinaryStorage`, 5MB limit) and `src/app/middleware/uploadManual.ts` (PDF-only, `memoryStorage`, 20MB limit, feeds `pdf-parse`) are the two existing precedents. **Neither fits this feature as-is** — this needs a single field that accepts _either_ mimetype, multiple files per request, so a third middleware is required (see Design §1).
- `bikeIssue` module (`src/app/modules/bikeIssue/`) is the structural template for the whole module: schema shape, `mergeParams: true` router, `findOwnedBikeOrThrow` ownership check, array-of-subdocuments-with-own-`_id` pattern for per-file deletion, and the `POST .../:id/images` + `DELETE .../:id/images/:imageId` sub-route pair. Copy its file layout (`.model.ts`, `.interface.ts`, `.controller.ts`, `.service.ts`, `.route.ts`, `.validation.ts`) and adapt, don't invent a new layout.
- `bikeManual`'s subdocument (`{ url, publicId, originalName, uploadedAt }`, single-file not array) is the precedent for storing `originalName` alongside a raw/PDF upload — worth carrying into the new per-file subdocument shape below, since a card showing "Bank Receipt" needs a filename to distinguish files that aren't previewable as thumbnails.

## Design

### 1. New shared upload plumbing — mixed image+PDF, multi-file

- **`src/app/middleware/uploadDocument.ts`** (new) — `multer({ storage: multer.memoryStorage(), fileFilter, limits: { fileSize: 20 * 1024 * 1024 } })`. `fileFilter` accepts `file.mimetype.startsWith("image/")` OR `file.mimetype === "application/pdf"`, otherwise rejects with `new AppError(httpStatus.BAD_REQUEST, "Only image or PDF files are allowed")`. Memory storage (not `CloudinaryStorage`) because the upload destination (`image` vs `raw` resource type) depends on each file's mimetype, which `CloudinaryStorage`'s single static `params` config can't branch on per-file.
- **`src/app/util/cloudinary.ts`** — add one new export, `uploadDocumentBuffer(buffer: Buffer, originalName: string, mimetype: string): Promise<{ url: string; publicId: string; resourceType: "image" | "raw" }>`. Same `cloudinary.uploader.upload_stream` shape as the existing `uploadRawBuffer`, but picks `resource_type: mimetype.startsWith("image/") ? "image" : "raw"` and returns it alongside `url`/`publicId` so the service layer can persist it per-file (needed later for correct-typed deletes). Don't modify `uploadRawBuffer` itself — `bikeManual` still calls it as-is; add the new function as a sibling, not a replacement.
- **`src/app/interface/image.interface.ts`** — add `TCloudinaryFile = TCloudinaryImage & { resourceType: "image" | "raw"; originalName: string; mimeType: string }` alongside the existing `TCloudinaryImage`. Don't touch `TCloudinaryImage` itself (still used, unchanged, by `bikeIssue`/`fuelLog`/`maintenanceLog`/`bikeAccessory`).

### 2. New module: `src/app/modules/bikeDocument/`

**`bikeDocument.interface.ts`**

```ts
import { ObjectId } from "mongoose";
import { TCloudinaryFile } from "../../interface/image.interface";

export type TBikeDocumentFile = TCloudinaryFile & { _id?: ObjectId };

export type TBikeDocument = {
  bike: ObjectId;
  title: string;
  description?: string;
  expiryDate?: Date;
  files?: TBikeDocumentFile[];
  isDeleted: boolean;
};
```

No `type`/category enum (register paper vs. tax token vs. license, etc.) — the user's own description frames this as free-text (_"I will give what type of paper or title like: 'Bike Registration Paper', 'Bank Receipt'"_), so `title` alone carries that meaning, matching `bikeIssue.title`'s free-text precedent rather than inventing a closed enum the user didn't ask for.

**`bikeDocument.model.ts`** — same shape as `bikeIssue.model.ts`: `bike` ref (required), `title` (required), `description` (optional), `expiryDate` (optional `Date`, no `default`), `files` as an array of subdocuments (`url`, `publicId`, `resourceType`, `originalName`, `mimeType` — default Mongoose behavior gives each its own `_id`), `isDeleted` (default `false`), `{ timestamps: true }`, plus the same `pre("find")` / `pre("findOne")` soft-delete hooks as every other module.

**`bikeDocument.validation.ts`** (Zod, mirrors `bikeIssue.validation.ts`)

```ts
const createBikeDocumentSchema = z.object({
  body: z.object({
    title: z.string({ required_error: "Title is required" }),
    description: z.string().optional(),
    expiryDate: z.coerce.date().optional(),
  }),
});

const updateBikeDocumentSchema = z.object({
  body: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    expiryDate: z.coerce.date().optional(),
  }),
});
```

No future-only/past-only `.refine()` on `expiryDate` — unlike `bikeIssue.dateReported` (which rejects future dates), an expiry date is inherently a future-leaning field but a user backfilling an already-expired paper is legitimate, so leave it unconstrained.

**`bikeDocument.service.ts`** — mirrors `bikeIssue.service.ts` structure:

- `createBikeDocumentIntoDB(bikeId, userId, payload)` — `findOwnedBikeOrThrow`, then `bikeDocumentModel.create({ ...payload, bike: bikeId })`.
- `getBikeDocumentsFromDB(bikeId, userId, query)` — ownership check, then list scoped to `bike`, paginated (`page`/`limit`, same convention as `bikeIssue`'s list endpoint), sorted by `expiryDate` ascending by default (nulls/no-expiry last) so documents expiring soonest surface first — this is the one deliberate list-ordering decision specific to this feature, since expiry urgency is the whole point of tracking these dates. Accept an optional `?sort=` override (e.g. `-createdAt`) for parity with other list endpoints, same as `bikeIssue`'s `sort=-dateReported` param.
- `getBikeDocumentByIdFromDB(bikeId, userId, id)`, `updateBikeDocumentIntoDB(bikeId, userId, id, payload)`, `deleteBikeDocumentFromDB(bikeId, userId, id)` — same ownership-scoped lookup pattern as `bikeIssue`. On delete, best-effort loop over `document.files` calling `deleteCloudinaryImage(file.publicId, file.resourceType)` for each before/after the Mongo soft-delete (best-effort — a Cloudinary cleanup failure must not block the user's delete, same as every other module's precedent).
- `addBikeDocumentFilesIntoDB(bikeId, userId, id, files: Express.Multer.File[])` — ownership check, load the record, throw `400` if `!files?.length`, then for each `file` call `uploadDocumentBuffer(file.buffer, file.originalname, file.mimetype)` and push `{ url, publicId, resourceType, originalName: file.originalname, mimeType: file.mimetype }` into `document.files`, save. Unlike `bikeIssue.addBikeIssueImagesIntoDB` (which reads `file.path`/`file.filename` directly off `CloudinaryStorage`'s auto-populated fields), this module's middleware uses `memoryStorage`, so the buffer must be uploaded manually per file inside the service — do this with `Promise.all` over the file array, not sequentially, to avoid a slow multi-file request.
- `deleteBikeDocumentFileFromDB(bikeId, userId, id, fileId)` — same shape as `bikeIssue.deleteBikeIssueImageFromDB`, but calls `deleteCloudinaryImage(targetFile.publicId, targetFile.resourceType)` (passing the stored resource type, not the default `"image"`) before pulling it out of the array.

**`bikeDocument.controller.ts`** — thin, `catchAsync` + `sendResponse(res, { status, success, message, data })`, one function per service function above (`createBikeDocument`, `getBikeDocuments`, `getBikeDocumentById`, `updateBikeDocument`, `deleteBikeDocument`, `addBikeDocumentFiles`, `deleteBikeDocumentFile`) — same shape as `bikeIssue.controller.ts`.

**`bikeDocument.route.ts`**

```ts
const router = Router({ mergeParams: true }); // mounted at /bikes/:bikeId/documents

router.post(
  "/",
  authCheck,
  validateRequest(bikeDocumentValidations.createBikeDocumentSchema),
  bikeDocumentController.createBikeDocument,
);
router.get("/", authCheck, bikeDocumentController.getBikeDocuments);
router.get("/:id", authCheck, bikeDocumentController.getBikeDocumentById);
router.patch(
  "/:id",
  authCheck,
  validateRequest(bikeDocumentValidations.updateBikeDocumentSchema),
  bikeDocumentController.updateBikeDocument,
);
router.delete("/:id", authCheck, bikeDocumentController.deleteBikeDocument);

// attach one or more files (image or PDF) — up to 10 per request
router.post(
  "/:id/files",
  authCheck,
  uploadDocument.array("files", 10),
  bikeDocumentController.addBikeDocumentFiles,
);

// remove a single file by its own subdocument id
router.delete(
  "/:id/files/:fileId",
  authCheck,
  bikeDocumentController.deleteBikeDocumentFile,
);

export const bikeDocumentRouter = router;
```

Field name `files` (not `images`) on the multipart route, and a cap of 10 per request (vs. `bikeIssue`'s 5) — a papers folder plausibly holds a multi-page scan (front+back of a license, multiple receipt pages), so a slightly higher cap is reasonable; not load-bearing, adjust if it turns out to matter.

### 3. Router registration

`src/app/router/index.ts` — add one entry to `routeArray`, same pattern as every other bike-scoped resource:

```ts
{
  path: "/bikes/:bikeId/documents",
  route: bikeDocumentRouter,
},
```

Import `bikeDocumentRouter` from `../modules/bikeDocument/bikeDocument.route` alongside the other module imports.

## Implementation

1. [x] `src/app/interface/image.interface.ts` — add `TCloudinaryFile`.
2. [x] `src/app/util/cloudinary.ts` — add `uploadDocumentBuffer(buffer, originalName, mimetype)`.
3. [x] `src/app/middleware/uploadDocument.ts` — new `memoryStorage` multer instance, mixed image/PDF `fileFilter`, 20MB limit.
4. [x] `src/app/modules/bikeDocument/bikeDocument.interface.ts`
5. [x] `src/app/modules/bikeDocument/bikeDocument.model.ts`
6. [x] `src/app/modules/bikeDocument/bikeDocument.validation.ts`
7. [x] `src/app/modules/bikeDocument/bikeDocument.service.ts`
8. [x] `src/app/modules/bikeDocument/bikeDocument.controller.ts`
9. [x] `src/app/modules/bikeDocument/bikeDocument.route.ts`
10. [x] `src/app/router/index.ts` — register `/bikes/:bikeId/documents`.
11. [x] Add the new requests (create/list/get/update/delete + add-files + delete-file, `multipart/form-data` for the files routes) to `postman/bikelog-api.postman_collection.json`, plus a short note in `postman/dummy-data.md`.
12. [x] Log the finished work in `context/progress-tracker.md`, following the existing per-entry format (date, one-line summary, prose paragraph, any "discovered during implementation" surprises, "Verified: ..." closing paragraph).

## Dependencies

No new npm packages — `cloudinary`, `multer` are already installed; this reuses them with a new middleware config, not a new library. Requires the same `CLOUDINARY_*` env vars already configured for `bikeIssue`/`bikeManual`.

## Verify-when-done

- [x] `yarn build` / `yarn lint` clean, no new errors/warnings beyond the existing tolerated baseline (same 14 pre-existing `no-console` warnings, 0 errors).
- [x] Create a document with just a `title` (no `description`, no `expiryDate`) — succeeds, `expiryDate` absent in the response, not `null`. Verified live via curl.
- [x] Create a document with `expiryDate: "2028-07-27"` — response echoes it back as a `Date`. Verified live via curl.
- [x] `POST` 2 files to one document in a single request — one `.png`, one `.pdf` — both appear in `files[]`, each with the correct `resourceType` (`"image"` vs `"raw"`), distinct `_id`s. Verified live via curl against real Cloudinary.
- [x] `GET` the document — `files[].url` for the PDF entry is a fetchable Cloudinary `raw` URL, not a broken `image`-type URL. Verified live (both URLs returned HTTP 200 on direct fetch).
- [x] `DELETE` one file by `fileId` — only that file's Cloudinary asset is destroyed (verified via direct HTTP request to its old URL, now 404); the other file and its own asset are untouched. Verified live — deleted the image, its URL 404'd, the PDF's URL still resolved.
- [x] Attempt to upload an 11th file in one request, or a non-image/non-PDF file (e.g. `.txt`) — both rejected with a clean `400`, never reaching Cloudinary. **Discovered during implementation**: `multer.MulterError` (e.g. `LIMIT_UNEXPECTED_FILE` for exceeding the 10-file cap) isn't an `AppError` and has no `.status`, so `globalErrorHandler`'s generic fallback initially returned a raw `500` instead of `400` for the 11-file case (the `fileFilter`-driven `.txt` rejection was already a clean 400, since that path already threw a real `AppError`). Fixed with a small route-local wrapper (`handleDocumentUpload` in `bikeDocument.route.ts`) that catches `multer.MulterError` and converts it to `AppError(400, ...)` — scoped to just this route, not a change to the shared `globalErrorHandler.ts` (which would've affected every other upload route in the app, beyond this spec's scope). Re-verified live after the fix: both cases now return a clean `400`.
- [x] `DELETE` the whole document (soft delete) — all remaining `files[]` Cloudinary assets are destroyed (best-effort loop), record no longer appears in `GET` list/detail. Verified live — confirmed the deleted asset via Cloudinary's own Admin API (`cloudinary.api.resource(...)` → "Resource not found"), since the delivery URL itself kept returning a cached `200` from CDN edge-caching our own earlier test fetches (expected `destroy()`-without-`invalidate` behavior, not a bug).
- [x] `GET` list endpoint — documents sort by `expiryDate` ascending by default (a document with an earlier expiry date appears before one with a later or absent expiry date). Verified live with 4 fixtures (past/near/far/no expiry) — order came back exactly as expected, no-expiry document sorted last.
- [x] All new endpoints 403/404 when attempted against a bike owned by a different user, matching `findOwnedBikeOrThrow`'s existing behavior everywhere else. Verified live with a second throwaway user — `list` and `create` against the first user's bike both 404'd.
