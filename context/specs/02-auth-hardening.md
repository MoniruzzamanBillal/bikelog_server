# Auth Hardening (`user` module)

## Goal

Unlike every other module, `user` already has working register/login logic (inherited from the `expense-tracker-server` clone) — it's not a stub. This spec doesn't build auth from scratch; it fixes the real bugs found in the current implementation, adds the one missing endpoint (`GET /api/auth/me`), and tightens the `req.user` type so every later module (bike, fuelLog, maintenanceLog) can rely on `req.user.userId` being type-safe instead of a bare `JwtPayload`.

## Design

**Bug fixes:**

1. **Unconditional password re-hash.** `user.model.ts`'s `pre("save")` hook hashes `this.password` on _every_ save, not just when the password field changed. Today this is latent (no update-user endpoint exists yet to trigger it), but it will silently double-hash the password the moment any future `.save()` call touches a user doc for an unrelated field. Fix: guard with `if (this.isModified("password")) { ... }`.
2. **Password hash leaking in responses.** Both `crateUser` and `signIn` controllers currently send back the full Mongoose document, including the argon2 hash, as `data`. Fix: `.select("-password")` on the `create`/`findOne` calls in `user.services.ts` (or strip manually before returning) — applies to `createUser`, `loginFromDb`'s `userData`, and the new `me` endpoint below.

**New endpoint — `GET /api/auth/me`** (listed in `bike-log-plan.md` §5, never implemented):

- `authCheck` only (no body).
- Service: `userModel.findById(req.user.userId).select("-password")`; `AppError(404, "User not found")` if somehow missing (deleted between token issue and use).
- Returns the current user doc (name/email/profilePicture/userRole/expoPushToken), no password.

**Type tightening — `req.user`:**

- Add `TJwtPayload = { userId: string; userEmail: string; userRole: TUserRole }` to `user.interface.ts`, reusing the `TUserRole` type that already exists there (`"admin" | "user"`).
- Update `src/app/interface/index.d.ts`'s `Express.Request.user` to `TJwtPayload` instead of bare `JwtPayload` (import the type; keep the `declare global` structure, just change the field type).
- Update `Jwt.sign(jwtPayload, ...)` in `user.services.ts` to type `jwtPayload` explicitly as `TJwtPayload` so the sign-time shape and the verify-time shape can't drift apart silently.
- This is what lets specs 03/04/08 write `req.user.userId` without `as any` casts.
- **Why `userRole` is included now even though there's no admin feature yet:** the user plans to add admin functionality in a later version (v2/v3). Baking `userRole` into the token payload today means future admin-gating middleware can just read `req.user.userRole` off tokens that are already being issued — no breaking change to the sign/verify shape later, no forced re-login for existing users when admin features land. Every user is `"user"` today (the model already defaults `userRole` to `UserRole.user`); this spec doesn't add any role-check logic, only the field.

**Config centralization:**

- Add `jwt_expires_in` to `src/app/config/index.ts` (read from `process.env.JWT_EXPIRES_IN`, default `"10d"` so behavior is unchanged if the env var isn't set).
- Replace the hardcoded `"10d"` literal in `user.services.ts`'s `Jwt.sign` call with `config.jwt_expires_in`.

**Naming cleanup:**

- Rename `crateUser` → `createUser` in `user.controller.ts` (typo). Update the corresponding import/reference in `user.route.ts`. Purely cosmetic, contained to these two files.

**Explicitly out of scope:** no refresh tokens, no logout/token-blacklist, no password-reset/forgot-password flow, no email verification — none of this is in `bike-log-plan.md`. No change to the `register`/`login` request/response shape beyond stripping the password field. No role-check/admin-gating middleware, no admin-only routes, no `req.user.userRole` consumers anywhere yet — `userRole` is added to the token purely as forward-compatible scaffolding for a later version; nothing in specs 03–09 branches on it.

## Implementation

1. `user.model.ts`: wrap the hash line in `if (this.isModified("password"))`.
2. `user.interface.ts`: add `TJwtPayload`.
3. `src/app/interface/index.d.ts`: change `Request.user` type to `TJwtPayload`.
4. `user.services.ts`: type `jwtPayload` as `TJwtPayload`, building it as `{ userId: userData?.id, userEmail: userData?.email, userRole: userData?.userRole }` in `loginFromDb`; use `config.jwt_expires_in`; add `.select("-password")` to `createUser`'s return and `loginFromDb`'s `userData` lookup; add a new `getMeFromDb(userId: string)` function.
5. `user.controller.ts`: rename `crateUser` → `createUser`; add `getMe` controller calling `userServices.getMeFromDb(req.user.userId)`.
6. `user.route.ts`: update the `createUser` reference; add `router.get("/me", authCheck, userController.getMe)`.
7. `src/app/config/index.ts`: add `jwt_expires_in`.

## Dependencies

None — this only touches the existing `user` module and shared config/type-declaration files. Nothing else needs to exist first.

## Verify-when-done

- [ ] `yarn build` succeeds (no type errors from the `req.user` type change rippling elsewhere — grep for other `req.user` usages first, since the type just got stricter).
- [ ] `yarn lint` clean.
- [ ] `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` manually verified — none of the three responses contain a `password` field.
- [ ] Updating any user field via a direct `.save()` in a REPL/test doesn't re-hash an already-hashed password (spot-check `isModified` guard works).
- [ ] Token still verifies correctly end-to-end (login → use token on a protected route) after the `req.user` type change.
- [ ] Decoding a freshly issued login token (e.g. via jwt.io or a quick script) shows `userRole: "user"` for a normal signup, alongside `userId`/`userEmail`.
