# Bike Owner Manual Upload + AI Chat Grounding

Status: ✅ Complete

## Goal

Let a user upload their bike's owner manual as a PDF (one per bike), extract and index its text, and have the existing AI chat (`POST /bikes/:bikeId/ai/chat`, `ai.service.ts`'s `getBikeChatReply`) pull the relevant excerpt(s) into its system prompt at question time. Today that endpoint only grounds answers in the bike's own fuel logs, maintenance logs, and lifetime spending — a question like *"I'm at 1200km and haven't changed my spark plug or air filter, when should I?"* can't be answered because that interval only exists in the manual, not in the app's data.

Retrieval must be plain in-process keyword/TF-IDF-style scoring over chunked text — **no embeddings API, no vector DB**. This was an explicit product decision (confirmed with the user) to match this codebase's existing house style of doing this kind of thing in plain JS (`.filter()`/`.reduce()`) rather than reaching for extra infra — see `context/architecture.md`'s aggregation-convention note for the precedent. A manual produces at most a few hundred chunks, so brute-force in-process scoring at chat time is cheap enough; no persistent vector index is needed.

## Aside (not part of this spec's scope)

`CLAUDE.md`'s "Current state" section still describes an uncommitted `src/app/util/SendImageCloudinary.ts` scaffolding file as in-progress work. That file doesn't exist — it was already superseded by the committed `src/app/util/cloudinary.ts` + `src/app/middleware/upload.ts` from spec 17 (commit `ace843f`). Worth fixing `CLAUDE.md` separately; unrelated to this feature.

## Existing scaffolding (reuse, don't rebuild)

- **Ownership check**: `findOwnedBikeOrThrow(bikeId, userId)` (`src/app/modules/bike/bike.utils.ts`) — already used by every nested-resource service, including `ai.service.ts` itself.
- **LLM choke point**: `askOpenRouter(messages: TChatMessage[], options?)` (`src/app/util/openRouterClient.ts`) — the single function all LLM calls must go through; do not add a second client.
- **Controller/response convention**: thin `catchAsync` handlers + `sendResponse(res, { status, success, message, data })` (note: `status`, not `statusCode`), errors via `throw new AppError(...)`.
- **Nested module shape**: mirrors `bikeIssue`/`bikeAccessory` — `Router({ mergeParams: true })` mounted under `/bikes/:bikeId/...`, registered in `src/app/router/index.ts`'s `routeArray`.
- **Cloudinary upload** (spec 17): `src/app/util/cloudinary.ts` (`cloudinary` client, `deleteCloudinaryImage`) and `src/app/middleware/upload.ts` (multer + `CloudinaryStorage`, image-only `fileFilter`, 5MB limit). That existing `upload` instance streams straight to Cloudinary and never exposes local file bytes (`req.file` only ever has `{ path, filename }`) — fine for images, but manual upload needs the raw PDF bytes locally to run text extraction. So this feature adds a **separate** multer instance using `multer.memoryStorage()` rather than modifying `upload.ts` (other modules depend on its current image-only behavior — don't touch it).
- **Derived-data convention**: collections like `mileageRecord` deliberately skip soft delete because they're regenerated from source data rather than user-authored records. Manual text chunks follow the same rule — hard-deleted and regenerated whenever the manual is replaced/removed, no `isDeleted` field, no pre-find hooks.

## Design

### 1. New module: `src/app/modules/bikeManual/`

**`bikeManual.interface.ts`**
```ts
export type TBikeManualMeta = {
  url: string;
  publicId: string;
  originalName: string;
  uploadedAt: Date;
  chunkCount: number;
};

export type TBikeManualChunk = {
  bike: ObjectId;
  chunkIndex: number;
  chunkText: string;
};
```

**`bikeManual.model.ts`** — `bikeManualChunkModel` over `TBikeManualChunk`, index on `{ bike: 1 }`, `{ timestamps: true }`. No soft delete, no pre-find hooks (derived data).

**`bikeManual.utils.ts`** — pure, dependency-free:
- `chunkManualText(rawText: string): string[]` — normalize whitespace, slide a window over words: 220-word chunks, 40-word overlap (step 180 words), hard cap of 500 chunks per manual (bounds pathologically large PDFs).
- `tokenize(text: string): string[]` — lowercase, strip punctuation, split on whitespace, drop a small hardcoded stopword set and 1-character tokens.
- `scoreAndRankChunks(chunks, question, topK): TBikeManualChunk[]` — tokenize the question; score each chunk by summed term weight over shared tokens (a `(1 + ln(tf)) * idf`-style heuristic — doesn't need to be textbook-correct BM25, just a reasonable relevance signal); keep chunks with score > 0; take the top `topK`; **re-sort that slice by `chunkIndex` ascending** so injected excerpts read in original manual order. Returns `[]` when there's no manual, no chunks, or no scoring tokens matched — the caller treats that as "skip the section," never an error.

**`bikeManual.service.ts`**:
- `uploadBikeManualIntoDB(bikeId, userId, file)` — see upload flow below.
- `getBikeManualMetaFromDB(bikeId, userId)` → `{ hasManual, manual }`.
- `deleteBikeManualFromDB(bikeId, userId)` — 404 if no manual, else cleans up.
- `getRelevantManualChunksForChat(bikeId, question, topK)` — `bikeManualChunkModel.find({ bike: bikeId }).select("chunkIndex chunkText").lean()` then `scoreAndRankChunks(...)`. This is the only function `ai.service.ts` imports from this module.

**`bikeManual.controller.ts`** — thin `catchAsync` + `sendResponse`, mirrors `bikeIssue.controller.ts`.

**`bikeManual.route.ts`** — `Router({ mergeParams: true })`, mounted at `/bikes/:bikeId/manual`:
- `POST /` — `authCheck`, `uploadManual.single("manual")`, upload-or-replace (upsert semantics, no separate `PUT`).
- `GET /` — `authCheck` — metadata only, no chunk text. Returns 200 with `hasManual: false` when absent (not a 404), consistent with how the insight endpoints return a "no data yet" message rather than erroring.
- `DELETE /` — `authCheck`.

No `validateRequest`/zod schema needed — multipart file body only, same as the existing image-upload routes which also skip `validateRequest`.

### 2. New middleware: `src/app/middleware/uploadManual.ts`

New file, doesn't touch `upload.ts`. `multer({ storage: multer.memoryStorage(), fileFilter, limits: { fileSize: 20 * 1024 * 1024 } })` — 20MB, bigger than the existing 5MB image limit since manuals are bigger files. `fileFilter` rejects with `AppError(400, "Only PDF files are allowed")` when `file.mimetype !== "application/pdf"`.

### 3. `src/app/util/cloudinary.ts` changes (backward-compatible)

- Add `uploadRawBuffer(buffer: Buffer, originalName: string): Promise<{ url: string; publicId: string }>` — wraps `cloudinary.uploader.upload_stream({ resource_type: "raw", public_id: <sanitized name, keeping the .pdf extension since raw delivery URLs need it> }, cb)` in a `Promise`, piping the buffer through.
- Generalize `deleteCloudinaryImage(publicId: string, resourceType: "image" | "raw" = "image")` — add the optional second param, pass `{ resource_type: resourceType }` into `cloudinary.uploader.destroy`. Default value keeps all 4 existing call sites (`fuelLog`, `maintenanceLog`, `bikeAccessory`, `bikeIssue` services) unaffected.

### 4. `Bike` schema changes — additive, optional (app is in production; no migration/backfill)

- `bike.interface.ts` — add `manual?: TBikeManualMeta;` (import from `../bikeManual/bikeManual.interface`; no circular-import risk since `bikeManual.model.ts` only needs an ObjectId ref to `"Bike"`, not bike's own types).
- `bike.model.ts` — add a `manual: { type: { url, publicId, originalName, uploadedAt, chunkCount }, _id: false }` subdocument field, following the same embedded-object shape spec 17 already used for e.g. `fuelLog.receiptImage`. No `required`, no `default` — existing bikes remain valid with the field simply absent.

### 5. Upload/replace flow — `uploadBikeManualIntoDB`

1. `findOwnedBikeOrThrow(bikeId, userId)`.
2. 400 if no file.
3. Extract text via `pdf-parse(file.buffer)`; 400 ("Could not extract text from this PDF") if the extracted text is empty after trim. Do this **before** touching Cloudinary/DB so a bad upload fails with zero side effects.
4. `chunkManualText(text)` → in-memory chunk strings.
5. If `bike.manual` already exists (replace case): `deleteCloudinaryImage(bike.manual.publicId, "raw")` then `bikeManualChunkModel.deleteMany({ bike: bikeId })` — delete-old-before-set-new, matching spec 17's existing receipt-image replace convention.
6. `uploadRawBuffer(file.buffer, file.originalname)` → `{ url, publicId }`.
7. `bikeManualChunkModel.insertMany(...)` for all chunks.
8. Set `bike.manual = { url, publicId, originalName, uploadedAt: new Date(), chunkCount }`, `bike.save()`.

`deleteBikeManualFromDB`: 404 if `!bike.manual`, else `deleteCloudinaryImage(publicId, "raw")` → `deleteMany` chunks → clear `bike.manual` → save.

### 6. `ai.service.ts` changes (`getBikeChatReply`)

- Add `MANUAL_CHUNK_TOP_K = 4` next to the existing `CHAT_LOG_LIMIT = 20` constant.
- Derive `latestUserQuestion` from the last `role: "user"` entry in the incoming `messages` array.
- Add a 4th parallel fetch alongside the existing `Promise.all([...])`: `bike.manual ? bikeManualServices.getRelevantManualChunksForChat(bikeId, latestUserQuestion, MANUAL_CHUNK_TOP_K) : Promise.resolve([])`.
- Build a `manualSection` string (only non-empty when chunks were found), labeled e.g. `Relevant excerpts from the owner's manual ("<originalName>"):` followed by the chunk texts, inserted into `systemMessage.content` alongside the existing fuel/maintenance/spending blocks. Extend the closing instruction ("Answer only using the data given above...") to also cover manual excerpts.
- Import `bikeManualServices` from `../bikeManual/bikeManual.service`.
- Keeps the existing "server builds the whole system prompt; client's `messages` can never contain `role: "system"`" security property untouched — `ai.validation.ts` doesn't need any change.

### 7. Routing + dependencies

- `src/app/router/index.ts` — add `{ path: "/bikes/:bikeId/manual", route: bikeManualRouter }` + its import.
- `package.json` — add `pdf-parse` (dependency) + `@types/pdf-parse` (devDependency; if its types prove unreliable, fall back to a local `.d.ts` shim declaring the module).

## Implementation

1. [x] `package.json` — add `pdf-parse` + `@types/pdf-parse`.
2. [x] New `src/app/middleware/uploadManual.ts` — memory-storage multer, PDF-only `fileFilter`, 20MB limit.
3. [x] `src/app/util/cloudinary.ts` — add `uploadRawBuffer`, generalize `deleteCloudinaryImage` with an optional `resourceType` param (default `"image"`).
4. [x] New `src/app/modules/bikeManual/bikeManual.interface.ts` — `TBikeManualMeta`, `TBikeManualChunk`.
5. [x] New `src/app/modules/bikeManual/bikeManual.model.ts` — `bikeManualChunkModel`.
6. [x] New `src/app/modules/bikeManual/bikeManual.utils.ts` — `chunkManualText`, `tokenize`, `scoreAndRankChunks`.
7. [x] New `src/app/modules/bikeManual/bikeManual.service.ts` — `uploadBikeManualIntoDB`, `getBikeManualMetaFromDB`, `deleteBikeManualFromDB`, `getRelevantManualChunksForChat`.
8. [x] New `src/app/modules/bikeManual/bikeManual.controller.ts`.
9. [x] New `src/app/modules/bikeManual/bikeManual.route.ts` — `POST /`, `GET /`, `DELETE /`.
10. [x] `src/app/modules/bike/bike.interface.ts` / `.model.ts` — add optional `manual` field.
11. [x] `src/app/router/index.ts` — register `bikeManualRouter` at `/bikes/:bikeId/manual`.
12. [x] `src/app/modules/ai/ai.service.ts` — `getBikeChatReply` fetches relevant manual chunks and injects them into the system prompt.
13. [x] Add the new requests to `postman/bikelog-api.postman_collection.json` (`multipart/form-data` for upload), plus a short note in `postman/dummy-data.md`.

## Verify-when-done

- [x] `yarn build` / `yarn lint` clean.
- [x] `POST /bikes/:bikeId/manual` with a real motorcycle owner's manual PDF (form field `manual`) → 200, `chunkCount > 0`.
- [x] `GET /bikes/:bikeId/manual` → reflects uploaded metadata; returns `hasManual: false` (200, not 404) before any upload.
- [x] `POST /bikes/:bikeId/ai/chat` with a question the manual actually answers (e.g. spark plug/air filter service interval) → reply references the manual's actual interval, not a generic/invented one.
- [x] Ask an unrelated question the manual doesn't cover → reply says so honestly rather than hallucinating (per the existing prompt convention).
- [x] Re-upload a different PDF to the same bike → old Cloudinary raw file + old chunks are gone, replaced cleanly.
- [x] `DELETE /bikes/:bikeId/manual` → subsequent chat calls stop including any manual section; `GET` shows `hasManual: false` again.
- [x] A non-PDF file upload attempt is rejected by `fileFilter` before ever reaching Cloudinary (clean 400, not 500).
- [x] New endpoints 404 when attempted against a bike owned by a different user, matching existing `findOwnedBikeOrThrow` behavior.
- [x] Confirm existing image-upload endpoints (`fuelLog`/`maintenanceLog`/`bikeAccessory`/`bikeIssue`) still work unaffected (`upload.ts` untouched, `deleteCloudinaryImage`'s new param is backward-compatible).

## Dependencies

New: `pdf-parse` (PDF text extraction) + `@types/pdf-parse`. No embeddings/vector-DB package — retrieval is plain in-process JS per the product decision above. No new env vars — `openRouterApiKey` and the `cloudinary_*` keys are already configured and reused as-is.
