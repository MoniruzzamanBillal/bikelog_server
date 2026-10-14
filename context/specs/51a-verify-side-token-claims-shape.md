# 51a: the `type` claim cannot be checked through `TJwtPayload` — the verify side needs a wider shape

Status: ✅ Complete — found and fixed 2026-10-11 while implementing spec 51. Found by `yarn build`, which is the only reason it was caught before runtime.

Sub-spec of `51-refresh-token-auth.md`. It records a conflict between two of that spec's own implementation steps, and the one-type fix for it.

---

## The error

Spec 51 §C step 2 says `TJwtPayload` gains `type?: "access"` — optional, so that pre-spec-51 tokens with no `type` claim keep working (its §0 H8). Step 8 then says `authCheck` must reject a token whose `type` is `"refresh"` (§0 H4).

Those two cannot both be done through `TJwtPayload`. `yarn build`:

```
src/app/middleware/authCheck.ts(44,7): error TS2367: This comparison appears to be unintentional
because the types '"access" | undefined' and '"refresh"' have no overlap.
```

TypeScript is right, and it is pointing at something real rather than being pedantic.

## Root cause — the cast is a claim about trusted data applied to untrusted data

`authCheck` does:

```ts
decoded = Jwt.verify(token, config.jwt_secret as string) as TJwtPayload;
```

`Jwt.verify` returns `string | JwtPayload`; the `as TJwtPayload` is an **assertion**, not a check. After it, TypeScript believes `decoded.type` can only be `"access" | undefined`, so comparing it with `"refresh"` is provably dead code — and it would be, *if the assertion were true*.

It isn't. The token is supplied by the caller. Its `type` claim can be any JSON value at all, which is precisely why §0 H4 wants it checked. So the type that describes **what this server mints** is the wrong type to describe **what a caller presents**, and using one for both is what produced a compile error over a check that is genuinely necessary.

Spec 02 established the rule that sign-time and verify-time shapes must not drift apart. This is that rule from the other direction: the verify-side shape has to be **wider**, because its input is untrusted, and then narrowed by an actual runtime check.

Note the failure mode had this been written to compile rather than to be correct: casting the comparison away (`(decoded.type as string) === "refresh"`) or widening `TJwtPayload.type` to `"access" | "refresh"` would both silence the error. The second is actively wrong — `req.user` is typed `TJwtPayload`, so it would then advertise that a request could be authenticated by a refresh token, which is the exact thing H4 forbids.

## Design

One new type in `user.interface.ts`, used only between `Jwt.verify` and the runtime check:

```ts
// What a CALLER presents. Every field is suspect: `type` is whatever JSON was signed, so it
// is `string | undefined` here, not the `"access"` literal this server mints.
export type TVerifiedTokenClaims = Omit<TJwtPayload, "type"> & {
  type?: string;
};
```

`authCheck` then verifies into `TVerifiedTokenClaims`, performs the H4 check against that, and only afterwards assigns to `req.user` (`TJwtPayload`) — which is sound at that point, because the check has ruled out the one `type` value `TJwtPayload` must never carry.

What stays exactly as spec 51 wrote it:

- `TJwtPayload.type` remains `?: "access"`. It is the **mint-time** shape, and keeping it a literal is what stops `signAccessToken` from ever signing a different value. It stays optional for H8 (legacy tokens).
- The H8 tolerance is unchanged: a missing `type` passes, only an explicit `"refresh"` is rejected.
- `TRefreshPayload.type` stays the required `"refresh"` literal — it too is a mint-time shape. The refresh service's own check (`decoded?.type !== "refresh"`) compiles without this change only because it is an inequality against a required literal; it is left alone.

## Out of scope

- No change to `src/app/interface/index.d.ts` — `Request.user` stays `TJwtPayload`, which is the point of narrowing before the assignment.
- No change to how `refreshAccessToken` verifies. Its cast has the same theoretical looseness, but its check is an inequality (`!== "refresh"`) against a required literal, so it both compiles and fails safe: any unexpected `type` value is rejected rather than accepted.
- No runtime schema validation of JWT claims (e.g. Zod on the decoded payload). It would be the thorough answer and is not needed for this defect; the two checks that matter are the signature and `type`.

## Implementation

- [x] 1. `user.interface.ts` — add `TVerifiedTokenClaims`, with the comment explaining why the verify side is wider than the mint side.
- [x] 2. `authCheck.ts` — verify into `TVerifiedTokenClaims`, keep the H4/H8 check against it, assign to `req.user` after it passes.
- [x] 3. `yarn build` and `yarn lint` clean.

## Verification

- [x] `yarn build` passes (it is the regression test — the original error was a compile error).
- [x] The H4 check is still live code, not optimised away: TypeScript no longer reports it as a comparison with no overlap, which means it is genuinely reachable.
- [x] Covered behaviourally by spec 51 §G's V8 (present a refresh token as a bearer token → 401) and V9 (a legacy no-`type` token still authenticates).
