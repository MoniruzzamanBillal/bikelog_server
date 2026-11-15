# Spec 66 — First unit tests: Vitest over the DB-free pure logic

**Status: Complete — implemented 2026-11-15. 21 tests, all passing (`yarn test`).**

## Why

The project had **no automated tests** anywhere (`yarn test` was a stub that exits 1); all
verification was Postman + static checks. Adding a test framework is gated by
`ai-workflow-rules.md` item 3 ("Don't add new core libraries/patterns without asking — … a
testing framework") — **explicitly authorized by the developer** before this spec.

This is the deliberate first step: unit tests for the **pure, DB-free** logic. The
`PrismaNeon` adapter cannot point at a local Postgres, so anything that calls `prisma` needs a
live Neon branch and is **out of scope here** (a later, separate decision). What that leaves is
still worth locking down — including the error mapper this session just added.

## What

- **Vitest** added as a dev dependency (with `vite` as its required peer). `package.json`
  scripts: `test` → `vitest run` (was the stub), plus `test:watch` → `vitest`.
- **`vitest.config.mts`** — `include: ["tests/**/*.test.ts"]`, `environment: "node"`. The
  `.mts` extension avoids the CJS-config-loader warning (the package is CommonJS). Tests live
  in **`tests/`, outside `src`**, so `tsc` (`include: ["src"]`) never compiles them into
  `dist`, and `eslint src` / the build are untouched.
- **Three suites, 21 tests:**
  - `tests/unit/handlePrismaError.test.ts` (10) — the spec-65 mapper, exercised against **real**
    `Prisma.PrismaClientKnownRequestError` / `PrismaClientValidationError` instances (constructed
    with code + meta the way Prisma throws them), not faked objects: P2002→409 (array target,
    string target, and the no-meta fallback), P2025→404 (with and without `meta.cause`),
    P2003/P2000/P2011→400, an unknown code→logged 500, and the validation error→400.
  - `tests/unit/handleZodError.test.ts` (3) — 400 status, path flattened to its last segment,
    one `errorSource` per failing field. Uses a real `z.object` parse to produce the `ZodError`.
  - `tests/unit/buildPrismaListQuery.test.ts` (8) — default sort + `createdAt` tie-breaker, `-`
    prefix → desc, whitespace- and comma-separated multi-field sorts, the no-double-append rule
    when `createdAt` is already in the sort, `skip`/`take` math, reserved-key stripping, and
    `baseWhere` (the ownership scope) coexisting with an extra filter.

## Scope / decisions

- **Pure functions only, by design.** No `prisma`, no HTTP, no network — so the suite runs in
  ~0.3 s with no external setup and is CI-ready as-is.
- **Not covered, and why:** the per-user-catalog multi-tenant isolation, the odometer-sequence
  guard, and the spending/period bucketing all run inside `prisma`-calling service functions.
  Testing them means either a Neon test branch (the "full setup" option the developer deferred)
  or first extracting the pure cores — both are separate, larger tasks. The bucketing logic in
  particular is currently inlined in `getPeriodCategoryBreakdownFromDB`; extracting it to a
  pure helper is the natural next unit-test target if this suite is extended.
- **App/web:** none. Server-only, dev-tooling only — no runtime code changed.

## Verify

- `yarn test` → `Test Files 3 passed (3) · Tests 21 passed (21)`.
- `yarn build` still clean (tests are outside `src`, never compiled into `dist`).
- `eslint src` unaffected (tests are outside `src`).
