# Fix: `user.model.ts` compile break after spec 31's `TUser` trim

## Status

Implementation-plan for a build error discovered while implementing spec 31, not a new phase. Resolve inline as part of spec 31, then delete/keep this file per normal practice (kept here as a record).

## Problem

Spec 31 §Implementation-2 says to narrow `TUser` in `user.interface.ts` to the create-payload shape only (`{ name, email, password }`), dropping `isDeleted`. But spec 31 §Implementation-3 also says `user.model.ts` **must stay in place, working**, because `notification.service.ts` (Phase 7) still imports `userModel` directly for Mongoose queries.

`user.model.ts` builds its Mongoose schema as `new Schema<TUser>({ ... isDeleted, userRole, expoPushToken ... })`. Once `TUser` no longer has those fields, `tsc` fails:

```
src/app/modules/user/user.model.ts(21,5): error TS2353: Object literal may only specify known properties, and 'isDeleted' does not exist in type 'TUser | ...'
src/app/modules/user/user.model.ts(42,10): error TS2339: Property 'password' does not exist on type '...'
```

(The second error is a knock-on: once the schema's generic type is wrong, the inferred document type used by the `pre("save")` hook loses `password` too.)

Same root cause also breaks `notification.service.ts`, which reads `.expoPushToken` off documents returned by `userModel` queries — that field no longer exists on `TUser`.

## Fix

Give the Mongoose layer its own local type, independent of the Prisma-era `TUser` create-payload type — mirroring the spec's own point that "Prisma's generated row type ... is a separate, unimported concern" from the trimmed interface. Concretely:

- In `user.model.ts`, define a local `TUserDocument` type (the pre-trim full shape: `name`, `email`, `password`, `isDeleted`, `userRole: TUserRole`, `expoPushToken?: string | null`) and use it as the schema's generic instead of the imported `TUser`. Keep importing `UserRole`/`TUserRole` from `user.interface.ts` (unchanged, per spec's explicit "do not rename" instruction) for the enum default and role type.
- Export `TUserDocument` from `user.model.ts` (not `user.interface.ts`, to keep the interface file Prisma-facing) so `notification.service.ts` can type its `userModel` query results against it without `any`/`as`.
- No behavior change: same schema fields, same defaults, same `pre("save")` hash hook, same collection — this is a type-only fix so the still-Mongoose-backed file keeps compiling and typing correctly until Phase 7 rewrites it.

## Files touched

- `src/app/modules/user/user.model.ts` — add local `TUserDocument` type, use it as schema generic, export it.
- `src/app/modules/notification/notification.service.ts` — import `TUserDocument` from `user.model.ts` (or accept the inferred query result type, whichever removes the `.expoPushToken` compile error) instead of relying on `TUser`. No logic change.

## Verify

- `yarn build` clean (no new errors in `user.model.ts` or `notification.service.ts`).
- `yarn lint` clean.
- `notification.service.ts`'s weekly-summary logic untouched behaviorally — same Mongoose query, same field read.
