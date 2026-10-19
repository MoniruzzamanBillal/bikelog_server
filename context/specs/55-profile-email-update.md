# 55 — The email is NOT editable: refuse it loudly on `PATCH /auth/update-profile`

**Status**: ✅ Code complete — implemented 2026-10-19. `yarn build` clean, `yarn lint` 0 errors / 36 warnings
(pre-existing `no-console` baseline, none in the touched files). Verified at **function level with Prisma
stubbed — 15 assertions, green**: the schema refuses `email` (present, or `null`) with the custom message and
still accepts `{ name }`, and the service's write is exactly `{ name }`.
**Scope**: `bikelog_server/` only — one real line of behaviour in `user.validation.ts`, plus comments in
`user.services.ts` and `user.route.ts` recording *why*. No migration, no new route, no response change.
**Companion**: `bikelog_app/ai context/specs/58-settings-edit-email.md` (the read-only field).
**Deploy order is free.** Nothing a correct client sends changes meaning, and `bikelog_client-web-` has no
profile editor at all.

**This spec replaces an earlier draft of itself, and the reversal is the most useful thing in it.** The
first version of this file made the email **editable** — optional `email` on the body, lower-cased, `P2002`
mapped to a 409 — written from the request *"in setting page, only user name and user photo can be updated.
user email can not be updated fix this."* read as "make it updatable". The developer's clarification was the
opposite: **"my requirement is user cant update their own email. it should be blocked from frontend and
backend."** The editable implementation was reverted in the same session (`git checkout` of the four user
files) and this spec rewritten. Nothing of it reached `master`. The lesson worth keeping: *"X can not be
done, fix this"* is ambiguous between "make X possible" and "make sure X stays impossible", and on a field
that is also a credential, the safe reading is the second one — **ask**.

---

## Request

> my requirement is user cant update their own email . it should be blocked from frontend and backend .

---

## Goal

A rider cannot change their own email through the API, and a client that tries is **told so** rather than
silently ignored.

---

## Design

### What was already true, and what was wrong with it

`updateProfileSchema` accepted `name` only, and a plain Zod object **strips** unknown keys. So
`PATCH /auth/update-profile` with `{ name, email }` answered **`200 Profile updated successfully!!!`** and
changed nothing but the name. The email was already unwritable — the service writes `data: { name }` — but
the response was indistinguishable from a successful change. That is the actual defect: not a hole, a lie.

### Decisions

| # | Decision | Why |
| --- | --- | --- |
| D1 | `email: z.undefined({ invalid_type_error: "Email can't be changed. It is the account's login identifier." })` | `z.undefined()` accepts an **absent** key and refuses a **present** one, which is exactly the rule. The custom message is the whole point — a bare `invalid_type` would say "expected undefined, received string", which tells a rider nothing |
| D2 | **Not** `.strict()` on the body | `.strict()` would refuse *any* unknown key, which is a behaviour change for every other field a client might send by accident, and its message names the key without saying why. D1 is surgical: one field, one reason |
| D3 | The service keeps `data: { name }` as a **literal** and gains a comment saying never to widen it | Two layers: the schema produces the message, the service makes the refusal true. A future "just spread the body" refactor is the realistic way this breaks, and the comment is aimed at it |
| D4 | `password`, `userRole` and `isDeleted` get **no** line of their own | They are unreachable for the same reason (D3) and nobody has ever tried to send them. `email` earns the explicit line because it sits visibly on the Settings screen right beside the name — it is the one a client plausibly submits |
| D5 | **No** verification flow, no change-email route, no admin route | There is no mail sender in this project. An unverifiable email change on the login identifier is strictly worse than no feature: one typo and the owner cannot sign in, with nothing on the server able to undo it. Changing a real user's address stays a deliberate DB write — the same documented convention as promoting an admin |
| D6 | `register` still sets the address, and `login` still matches on it | Untouched. This spec is about the *owner-editable* surface only |

### Contract

```
PATCH /api/auth/update-profile      (authCheck)
body: { name: string }                       // 1-60 chars after trim
200 -> { success: true, message: "Profile updated successfully!!!", data: <safe user> }
400 -> blank/missing/over-long name, OR an `email` key is present:
        "Email can't be changed. It is the account's login identifier."
404 -> the token's user is missing or soft-deleted
```

---

## Hazards

| # | Hazard | Handling |
| --- | --- | --- |
| H1 | A client that *currently* sends `email` would start getting a 400 where it used to get a 200 | Nothing does. The app sends `{ name }` (its spec 56), `bikelog_client-web-` has no profile editor, and the Postman request sends name only. Checked by grep across both clients before shipping |
| H2 | The refusal could be mistaken for the field being *writable but validated* | The message names the reason, not the format. The app's field is visibly locked with a padlock and a one-line note, so the 400 is a backstop that a rider should never see |
| H3 | Someone later "fixes" the 400 by making the field editable | This file is the answer: D5 is the reason, and it does not expire until the project has a mail sender and a verification loop. If that day comes, the spec it needs is a *change-email* flow — token, confirmation, old-address notice — not a key on this schema |
| H4 | A rider genuinely needs their address changed | Operator action: a direct DB write, as `../../CLAUDE.md` already documents for admin promotion. Worth noting it also moves their identity in `expenseTracker2`, which keys ingest on `userEmail` |

---

## Implementation steps

1. `user.validation.ts` — add the `email: z.undefined(...)` line to `updateProfileSchema`, with the comment
   explaining the silent-strip behaviour it replaces. ✅
2. `user.services.ts` — comment on the `data: { name }` literal: this is the enforcement, do not widen. ✅
3. `user.route.ts` — comment recording that `name` is the only writable field here. ✅
4. Postman — the happy-path description now states the refusal; a new
   **"Update Profile with an email (expect 400)"** request proves it. ✅
5. `postman/dummy-data.md` — the field table gains an `email → refused` row and the three reasons. ✅

---

## Test plan

| # | Check | State |
| --- | --- | --- |
| V1 | `{ name: "X" }` still answers 200 and writes the name | ✅ stubbed |
| V2 | `{ name: "X", email: "new@mail.com" }` is a **400** with the custom message | ✅ stubbed |
| V3 | `{ email: "new@mail.com" }` alone is a 400 | ✅ stubbed |
| V4 | `{ name: "X", email: null }` is a 400 (a null is a present key) | ✅ stubbed |
| V5 | The service's Prisma write is exactly `{ name }` | ✅ stubbed |
| V6 | Blank name, missing name and 61-char name all still 400 | ✅ stubbed |
| V7 | Over HTTP: the 400, then `GET /auth/me` showing the address unchanged | ⬜ Postman |
| V8 | Over HTTP: the app's real save (name only) still answers 200 | ⬜ Postman |
| V9 | `yarn build` + `yarn lint` clean | ✅ |
