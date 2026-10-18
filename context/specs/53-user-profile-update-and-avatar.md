# 53 — User profile: update the name, upload / replace / remove the profile picture

**Status**: ✅ Code complete — implemented 2026-10-18. All 8 implementation steps done; `yarn build` clean and
`yarn lint` 0 errors / 23 warnings (identical to the pre-existing baseline, none in the five touched files).
**The migration has NOT been applied and the code is NOT deployed** — both are operator steps, and the migration
must go first (§1). V1 is the only Verify item that has run; V2–V19 need the migration applied plus a live server,
so nothing here has been exercised over HTTP.
**Scope**: `bikelog_server/` only — one Prisma migration (one additive nullable column), one new multer
middleware, three new routes under `/api/auth`, plus small additions to `user.services.ts`,
`user.controller.ts`, `user.validation.ts` and `user.route.ts`.
**Companion**: `bikelog_app/ai context/specs/56-settings-profile-update.md` (the Settings UI).
**Build and deploy this first.** The app spec is written against the response shapes defined here, and
nothing in the app half can work before this exists — `users` has no picture column today and there is no
route that can write `name`.
**`bikelog_client-web-` needs no change** (cascade step 3 is not triggered): every change here is additive —
one new field on user responses that already exist, and three brand-new routes the web client does not call.

---

## Request

> now in my project app project, in setting page, i should have functionality for updating user. user can
> update user name and upload and edit user image.

The app half is the deliverable; this is the backend it needs. Today `users` has `id, name, email, password,
isDeleted, userRole, expoPushToken, createdAt, updatedAt` and nothing more — **no picture column at all** —
and the only writable user field on the whole API is `expoPushToken` (`POST /auth/push-token`). `name` is
set once at register and can never be changed.

---

## Goal

Let the logged-in user change their own display name, and set, replace and remove their own profile picture
(stored on Cloudinary, with the old asset cleaned up), exposing the picture on every endpoint that already
returns a user so the client can read it from `GET /auth/me`.

---

## Design

### Decisions

| # | Decision | Why |
| --- | --- | --- |
| D1 | **Two separate concerns, three routes**: `PATCH /api/auth/update-profile` for the name (JSON + Zod) and `PUT`/`DELETE /api/auth/profile-picture` for the image (multipart) | Exactly the split `bikeAccessory` already makes — `PATCH /:id` for fields, `PUT /:id/image` + `DELETE /:id/image` for the asset. A Zod-validated JSON route and a multipart route cannot be the same route without `validateRequest` choking on an unparsed body. It also keeps the two mutations independent: in the app the photo uploads immediately while **Save** means "save my name" only, so neither can half-commit the other |
| D2 | Multipart field name **`image`** | House convention: `upload.single("image")` in `bikeAccessory.route.ts`. The reference project uses `file`; matching this repo's own precedent matters more than matching the other project's, and the app's `FormData` append uses `"image"` everywhere already |
| D3 | A **new** multer instance `uploadAvatar`, not the shared `upload` | Two things must differ: a Cloudinary `folder` and a `transformation` (D6), and a smaller size cap (D5). `upload` is used by `bikeAccessory` and `bikeIssue` and must not change behaviour |
| D4 | Storage shape: one nullable **`profilePicture Json?`** column holding `{ url, publicId }` | Mirrors `BikeAccessory.productImage` exactly — same `Json?`, same two keys, same `as { url, publicId } \| null` read. One column means one `set` writes both halves and one write clears both; two scalar columns (what the reference project did) can drift apart. The client already has a `TCloudinaryImage = { url, publicId }` type and an `ImageViewerModal` that consumes it |
| D5 | Image only, cap **4 MB** | An avatar has no PDF case. 4, not `upload`'s 5: Vercel refuses a request body over ~4.5 MB before it ever reaches multer, so a 5 MB cap makes the clean `400` unreachable in production. 4 MB is comfortably inside that and still generous for a square-cropped phone photo at `quality: 0.7`. (`upload`'s 5 MB is a pre-existing inconsistency; **do not** "fix" it here — it is not this spec's scope) |
| D6 | Cloudinary transformation at upload: `{ width: 512, height: 512, crop: "fill", gravity: "face" }`, `folder: "bikelog/avatars"` | The app deliberately does **no** client-side resize (it would need a new native module — see the app spec's Dependencies), so normalising server-side is what keeps the stored asset small and square. `gravity: "face"` centres on a face when there is one and falls back to centre. The folder keeps avatars out of the flat bucket every other upload lands in |
| D7 | **Upload (multer) → DB write → delete the old asset**, in that order | With `CloudinaryStorage` the new asset is already uploaded by the time the service function runs, so the only ordering choice left is delete-before-write or delete-after-write. After: the worst case is one orphaned Cloudinary asset (invisible storage waste), where before leaves a window in which the row points at a deleted asset. `uploadBikeAccessoryImageIntoDB` deletes before the write — this is a deliberate, documented improvement on it, not an oversight |
| D8 | `safeUserSelect` gains `profilePicture` | That one line is what makes `GET /auth/me`, `POST /auth/register` and `POST /auth/push-token` all return the picture with no further change — and `/auth/me` is the single source the app's Settings panel reads. Additive: no existing field is renamed or retyped |
| D9 | The **login response is untouched** | `signIn` answers `{ data: null, token, refreshToken }` and the app builds its stored user from the token's claims. Minting `name`/`profilePicture` into the JWT would put mutable display data in a 15-minute credential and grow every request header; the app reads them from `/auth/me` instead |
| D10 | No change to the `expenseTracker2` integration, the cron routes or `error_logs` | Nothing here is a spend event, and these routes' failures are ordinary request errors that the existing handler already logs |

### Contract

```
PATCH /api/auth/update-profile
  Headers : Authorization: Bearer <access token>
  Body    : { "name": "Moniruzzaman Billal" }
  200     : { success: true, message: "Profile updated successfully!!!",
              data: { _id, id, name, email, profilePicture, isDeleted, userRole,
                      expoPushToken, createdAt, updatedAt } }
  400     : name missing / not a string / empty after trim / over 60 chars (Zod)
  401     : missing or expired access token (the app refreshes and replays — routine)
  404     : user not found

PUT /api/auth/profile-picture
  Headers : Authorization: Bearer <access token>
  Body    : multipart/form-data, one part named "image" (image/*, <= 4 MB)
  200     : { success: true, message: "Profile picture uploaded successfully",
              data: <same user shape, profilePicture: { url, publicId }> }
  400     : no "image" part / wrong field name / not an image / over 4 MB
  404     : user not found

DELETE /api/auth/profile-picture
  200     : { success: true, message: "Profile picture deleted successfully",
              data: <same user shape, profilePicture: null> }
  404     : user not found, or there is no picture to remove
```

All three sit behind `authCheck` and act on `req.user.userId` only — there is no user id in any path, so
there is no IDOR surface to get wrong (contrast the catalog routes, which needed spec 46's whole
owner-scoping pass).

### Schema

```prisma
model User {
  id             String   @id
  name           String
  email          String   @unique
  password       String
  profilePicture Json?    // { url, publicId } — same shape as BikeAccessory.productImage
  isDeleted      Boolean  @default(false)
  userRole       Role     @default(user)
  expoPushToken  String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  ...
}
```

Additive and nullable: no backfill, no downtime, safe against the live table. Every existing row keeps
`NULL`, which reads back as `null` and renders as initials in the app.

### Hazards

| # | Hazard | Handling |
| --- | --- | --- |
| H1 | **`name` is `String` NOT NULL.** A PATCH that writes `null` or `""` would either throw a raw Prisma error (500) or leave a user with a blank name in every screen | Zod: `z.string().trim().min(1).max(60)`. `trim()` **before** `min(1)`, so `"   "` is a 400 and not a saved blank. Never build the `data` object with a possibly-undefined `name` |
| H2 | **Clearing a `Json?` column is not `null`.** Prisma rejects a bare `null` for a `Json` field — it needs `Prisma.JsonNull` or `Prisma.DbNull`, and the two are not the same thing (JSON `null` in the column vs. SQL `NULL`) | Use **`Prisma.JsonNull`**, because that is what `deleteBikeAccessoryImageFromDB` uses and both read back to the JS value `null`, so the `as { url, publicId } \| null` cast and every `if (!picture)` guard behave identically. Consequence to know and not trip over: after a remove the column holds JSON `null`, not SQL `NULL`, so a `where: { profilePicture: null }` filter would not match it. Nothing filters on this column, and nothing should |
| H3 | **A `MulterError` is not an `AppError`** and has no `.status`, so `globalErrorHandler` turns the 4 MB breach — the single most likely client error on this route — into an unhelpful 500 | Wrap `uploadAvatar.single("image")` in the `MulterError → 400` normaliser. `bikeDocument.route.ts`'s `handleDocumentUpload` is the precedent to copy; put this one in the middleware file so `user.route.ts` stays clean |
| H4 | **A wrong field name is swallowed by multer, not by the service.** `upload.single("image")` rejects a part named anything else with its own `"Unexpected field"` `MulterError` (→ a 400 via H3), so the service's own `if (!file)` guard is only reachable when no file part is sent at all | Keep the guard anyway — without it `file.path` is a raw `TypeError` → 500 — but do not expect it to be the thing that catches a typo'd field name. The reference project's spec 20 recorded the same deviation |
| H5 | **`CloudinaryStorage` has already uploaded by the time the service runs**, so a 404 thrown after it (user not found) leaks an orphaned asset | Accepted, and it is the same trade `bikeAccessory` already makes. The case is near-impossible: `authCheck` has verified a token whose `userId` was read from a live row at mint or refresh time. Not worth a pre-flight existence query on every upload |
| H6 | `deleteCloudinaryImage` is **best-effort** — it swallows its own failure | Deliberate, unchanged from the existing helper: a Cloudinary outage must not fail the user's own replace/remove. The cost is an orphaned asset, which is invisible to the user |
| H7 | **Never run `prisma migrate dev` against this database.** On detected drift it offers to reset — drop — the database, and it needs a shadow DB | The migration is hand-written (Implementation §1) and applied with `yarn db:migrate` (`prisma migrate deploy`) only. This is the rule spec 46's rollout learned the hard way; `deploy.yml` does not run migrations, so applying it is an operator step |
| H8 | `_prisma_migrations` still holds spec 46's **failed** `20261004061600_catalog_owner_not_null` row | It was resolved as rolled back and then re-applied successfully, so `migrate deploy` is clean today — but **run `npx prisma migrate status` before applying this one** rather than assuming it |

---

## Implementation

### ✅ 1. Migration — additive, hand-written

Add `profilePicture Json?` to `model User` in `prisma/schema.prisma` (position it after `password`, as in the
Schema block above), then create the migration directory **by hand**:

`prisma/migrations/20261018xxxxxx_add_user_profile_picture/migration.sql`

```sql
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "profilePicture" JSONB;
```

Use a real UTC timestamp for the folder name, matching the format of the four existing migrations. Then
`npx prisma generate` to refresh the client types (`postinstall` also runs it).

**Do not run `prisma migrate dev`** (H7). Applying the migration is an operator step: `npx prisma migrate
status` first (H8), then `yarn db:migrate`, with `DATABASE_URL_UNPOOLED` set — `prisma.config.ts` points
migrations at the direct Neon URL, not the pooled one.

### ✅ 2. New middleware — `src/app/middleware/uploadAvatar.ts`

Model it on `upload.ts`, which it must not modify:

```ts
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "bikelog/avatars",
    // ! 512 square, filled, face-centred: the app does no client-side resize (that would
    // ! need a new native module and an EAS rebuild), so normalising happens here.
    transformation: [{ width: 512, height: 512, crop: "fill", gravity: "face" }],
    public_id: (_req, file) => /* same random-plus-timestamp scheme as upload.ts */,
  } as never,
});

export const uploadAvatar = multer({
  storage,
  fileFilter: imageFileFilter,          // image/* only, else AppError 400
  // ! 4 MB, not upload.ts's 5: Vercel refuses a body over ~4.5 MB before multer sees it,
  // ! so a 5 MB cap would make the clean 400 below unreachable in production.
  limits: { fileSize: 4 * 1024 * 1024 },
});
```

`multer-storage-cloudinary`'s `params` typing does not advertise `folder`/`transformation` as statically as
this reads — if `tsc` objects, cast the params object rather than loosening the middleware's exported type,
and leave a comment saying which key forced it.

**What happened (2026-10-18): `tsc` did object**, with `TS2353: 'folder' does not exist in type 'Params'`. The
cause is worth recording because it is not what the sentence above implies. `folder` and `transformation` are
both real, declared keys on Cloudinary's `UploadApiOptions` — but that interface also carries
`[futureKey: string]: any`, and `multer-storage-cloudinary` derives its `Params` type through a
`KnownKeys<UploadApiOptions>` helper written to strip exactly that index signature. Under current TypeScript that
helper evaluates to `never`, so `PickedUploadApiOptions` collapses to `{}` and `Params` admits `public_id` and
nothing else. So the library's typing cannot express either key, and no amount of restructuring avoids it.
Resolved as instructed: the params object is built as a named local and cast once at the use site
(`avatarStorageParams as unknown as Options["params"]`, importing the library's own exported `Options`), with a
comment naming `folder` as the forcing key. `uploadAvatar`'s own exported type is untouched. No sub-spec was
written for this, because it is the branch this step already authorised rather than an unforeseen defect.

In the same file export the `MulterError → 400` wrapper (H3), copying `bikeDocument.route.ts`'s
`handleDocumentUpload` shape:

```ts
export const handleAvatarUpload = (req, res, next) => {
  uploadAvatar.single("image")(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      return next(new AppError(httpStatus.BAD_REQUEST, error.message));
    }
    if (error) return next(error);
    next();
  });
};
```

### ✅ 3. Validation — `user.validation.ts`

```ts
// ! trim() runs BEFORE min(1), so "   " is a 400 and never a saved blank name (H1).
const updateProfileSchema = z.object({
  body: z.object({
    name: z
      .string({ required_error: "User name is required" })
      .trim()
      .min(1, { message: "Name cannot be empty" })
      .max(60, { message: "Name must be 60 characters or fewer" }),
  }),
});
```

Export it from `userValidations`. Nothing else in this file changes; `email` and `password` are deliberately
not editable (Out of scope).

### ✅ 4. Service — `user.services.ts`

Add `profilePicture: true` to `safeUserSelect` (D8). Then three functions, each following the file's
existing `{ ...result, _id: result.id }` return convention:

```ts
// ! for updating the logged-in user's own display name
const updateProfile = async (userId: string, name: string) => {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isDeleted: true },
  });
  if (!existing || existing.isDeleted) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  const result = await prisma.user.update({
    where: { id: userId },
    data: { name },                      // already trimmed and non-empty by Zod (H1)
    select: safeUserSelect,
  });

  return { ...result, _id: result.id };
};
```

```ts
// ! for setting or replacing the logged-in user's profile picture
const updateProfilePicture = async (
  userId: string,
  file: Express.Multer.File | undefined,
) => {
  // ! multer leaves req.file undefined when no "image" part was parsed at all — without this
  // ! guard `file.path` below is a raw TypeError, i.e. a 500. A *wrong* field name never gets
  // ! here; multer rejects it itself (H4).
  if (!file) {
    throw new AppError(httpStatus.BAD_REQUEST, "Image file is required");
  }

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isDeleted: true, profilePicture: true },
  });
  if (!existing || existing.isDeleted) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  const previous = existing.profilePicture as TUserProfilePicture | null;

  const result = await prisma.user.update({
    where: { id: userId },
    // ! file.path is the Cloudinary secure URL and file.filename the public_id — that is what
    // ! CloudinaryStorage puts there, same as bikeAccessory's image upload.
    data: { profilePicture: { url: file.path, publicId: file.filename } },
    select: safeUserSelect,
  });

  // ! After the write, not before (D7): the new asset is already uploaded by multer, so
  // ! deleting the old one last means the row never points at a deleted asset. Best-effort.
  if (previous?.publicId) {
    await deleteCloudinaryImage(previous.publicId);
  }

  return { ...result, _id: result.id };
};
```

```ts
// ! for removing the logged-in user's profile picture
const deleteProfilePicture = async (userId: string) => {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isDeleted: true, profilePicture: true },
  });
  if (!existing || existing.isDeleted) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  const previous = existing.profilePicture as TUserProfilePicture | null;
  if (!previous) {
    throw new AppError(httpStatus.NOT_FOUND, "Profile picture not found");
  }

  await deleteCloudinaryImage(previous.publicId);

  const result = await prisma.user.update({
    where: { id: userId },
    // ! Prisma.JsonNull, NOT null — a bare null is rejected for a Json field. Reads back as
    // ! the JS value `null`, same as bikeAccessory's image removal (H2).
    data: { profilePicture: Prisma.JsonNull },
    select: safeUserSelect,
  });

  return { ...result, _id: result.id };
};
```

Add all three to the exported `userServices`. `Prisma` is already imported in this file (the `P2002` catch);
`deleteCloudinaryImage` is a new import from `../../util/cloudinary`.

### ✅ 5. Interface — `user.interface.ts`

```ts
// ! The shape stored in User.profilePicture (Json?). Same two keys as
// ! BikeAccessory.productImage, and the same shape the app's TCloudinaryImage expects.
export type TUserProfilePicture = {
  url: string;
  publicId: string;
};
```

### ✅ 6. Controller — `user.controller.ts`

Three `catchAsync` handlers in the file's existing style, each passing `req.user.userId`:

- `updateProfile` → `req.body.name`, message `"Profile updated successfully!!!"`.
- `updateProfilePicture` → `req.file`, message `"Profile picture uploaded successfully"`.
- `deleteProfilePicture` → message `"Profile picture deleted successfully"`.

All three `sendResponse(... status: httpStatus.OK, success: true, data: result)`. Add them to
`userController`.

### ✅ 7. Routes — `user.route.ts`

```ts
// ! for updating the logged-in user's own name
router.patch(
  "/update-profile",
  authCheck,
  validateRequest(userValidations.updateProfileSchema),
  userController.updateProfile,
);

// ! for setting/replacing the logged-in user's profile picture
router.put("/profile-picture", authCheck, handleAvatarUpload, userController.updateProfilePicture);

// ! for removing the logged-in user's profile picture
router.delete("/profile-picture", authCheck, userController.deleteProfilePicture);
```

Order matters only against `/:param` routes, and this router has none — but keep them after `/me` for
readability. **`handleAvatarUpload` goes after `authCheck`**, so an unauthenticated request is refused
before anything is uploaded to Cloudinary.

Note for whoever next touches `utils/axiosInstance.ts` in the app: all three are `authCheck` routes under
`/auth`, i.e. exactly the category spec 51c's `PUBLIC_AUTH_ROUTES` whitelist was built to keep working. The
whitelist is closed and these are not on it, so they get refresh-and-retry automatically — **no client
interceptor change is needed**, and none should be made.

### ✅ 8. Postman + docs

- Add the three requests to `postman/bikelog-api.postman_collection.json` under the Auth folder, the `PUT`
  as `form-data` with one `image` file part. `postman/HORNET 2.0 USER MANUAL.pdf` is a convenient
  wrong-type fixture for the 400.
- `postman/dummy-data.md`: a row for `name` (required, trimmed, 1–60) and for the `image` part
  (`image/*`, ≤ 4 MB, field name `image`).
- `context/progress-tracker.md`: a spec 53 row (added when this file was written, per the standing rule)
  plus a Recent Activity entry on completion.
- `CLAUDE.md`: the user module's route list and the `users` column list both change — update both.

---

## Dependencies

**No new packages.** Everything is already in `package.json` and already used in `src/`:
`multer`, `multer-storage-cloudinary`, `cloudinary` (via `util/cloudinary.ts`), `zod`, `@prisma/client`.
No new env var — `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` are already
required and already in use.

One **operator** dependency, not a package: the migration in §1 must be applied with `yarn db:migrate`
before the deployed code reads the new column. Deploying the code first makes every user response 500 on a
missing column, so apply the migration **first** — it is additive, so the old code is unaffected by it.

---

## Verify

`yarn build` + `yarn lint` (no *new* findings — this repo carries pre-existing errors/warnings outside the
Bike Log modules), then the Postman pass below against a locally-run server on a Neon branch. There is no
test suite in this repo; a live run is the only real verification.

- [x] **V1** `yarn build` clean, `yarn lint` shows no new findings in the five touched files. **Done 2026-10-18** —
      build clean; lint 0 errors / 23 warnings, byte-identical to the baseline the tracker records for spec 51, and
      every warning is a pre-existing `no-console` outside this change.
- [ ] **V2** `npx prisma migrate status` clean *before* applying, then `yarn db:migrate` applies exactly one
      new migration, and `profilePicture` exists on `users` as nullable `jsonb`.
- [ ] **V3** `GET /auth/me` now returns `profilePicture: null` for an untouched account, and every other
      field is byte-identical to before (the additive check).
- [ ] **V4** `PATCH /auth/update-profile` with `{ "name": "New Name" }` → 200, `data.name` is the new name,
      and a follow-up `GET /auth/me` agrees.
- [ ] **V5** `PATCH /auth/update-profile` with `{ "name": "   " }` → **400**, and `GET /auth/me` still shows
      the old name (H1 — the blank was never written).
- [ ] **V6** `PATCH /auth/update-profile` with no body, with `name: 123`, and with a 61-character name → 400
      each.
- [ ] **V7** `PUT /auth/profile-picture` with a JPEG as `image` → 200, `data.profilePicture` is
      `{ url, publicId }`, the URL loads in a browser, and the fetched image is **512×512** (D6 applied).
- [ ] **V8** Upload a second, different image → 200, the URL changes, and the **first** asset is gone from
      Cloudinary (D7's cleanup actually ran). Check the `bikelog/avatars` folder, not the bucket root.
- [ ] **V9** `PUT /auth/profile-picture` with the part named `file` instead of `image` → **400**
      `"Unexpected field"` (H4), nothing uploaded, picture unchanged.
- [ ] **V10** `PUT /auth/profile-picture` with a PDF → 400 `"Only image files are allowed"`.
- [ ] **V11** `PUT /auth/profile-picture` with a >4 MB image → **400** from the `MulterError` normaliser, not
      a 500 (H3). This is the one that proves §2's wrapper is wired.
- [ ] **V12** `PUT /auth/profile-picture` with no file part at all → 400 `"Image file is required"`.
- [ ] **V13** `DELETE /auth/profile-picture` → 200, `data.profilePicture` is `null`, the Cloudinary asset is
      gone, and a second `DELETE` → **404** `"Profile picture not found"`.
- [ ] **V14** After V13, `GET /auth/me` returns `profilePicture: null` — i.e. `Prisma.JsonNull` reads back as
      JS `null` and no guard in the service mistakes it for an object (H2).
- [ ] **V15** All three routes with no `Authorization` header → 401, and with another user's valid token the
      change lands on **that** user only (each route acts on `req.user.userId`; verify with two throwaway
      accounts that A's upload never appears on B's `/auth/me`).
- [ ] **V16** With an **expired** access token, the app's interceptor refreshes and replays: the `PATCH` and
      the `DELETE` succeed on the retry. The `PUT` is the one worth watching — a replayed multipart body is
      a stream, so confirm the retry actually re-sends the file rather than an empty part. If it does not,
      that is an app-side finding, not a server one; record it in the app spec, don't patch it here.
- [ ] **V17** `POST /auth/register` and `POST /auth/push-token` both now return `profilePicture` and are
      otherwise unchanged (D8's blast radius).
- [ ] **V18** The `bikeAccessory` and `bikeIssue` image uploads still work unchanged — `upload.ts` was not
      touched, which is the check that §2 added a middleware rather than editing one.
- [ ] **V19** `error_logs` gets an ordinary row for a deliberate failure on these routes (e.g. a bad
      Cloudinary secret → 502/500), and **no** row for the routine 400s above beyond what the existing
      handler already logs.

---

## Out of scope

- **Email and password editing.** Email is the unique login key and changing it needs a verification flow;
  password needs the current password plus a confirm field. Both are their own spec. The app spec renders
  the email read-only with a line saying so.
- **Admin editing another user's profile.** There is no user-management surface at all (making a user an
  admin is still a direct DB write, by documented convention) and these three routes deliberately take no
  user id.
- **Putting `name`/`profilePicture` in the JWT** (D9) and any change to the login or refresh response.
- **Reconciling `upload.ts`'s 5 MB cap** with Vercel's body limit (D5) — a real but separate finding; note
  it in the tracker's Known Gaps instead.
- **Centralising Prisma error mapping** in `globalErrorHandler`, and the four-file `mongoose` cleanup. Both
  are standing tasks this spec deliberately does not pull in.
