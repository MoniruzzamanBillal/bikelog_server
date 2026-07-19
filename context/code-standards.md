# Code Standards

## TypeScript Conventions

- Domain types are plain `type` aliases prefixed with `T` (e.g. `TUser`, `Tresponse<T>`, `TerrorSource`) — not interfaces, not `I`-prefixed. Follow this existing convention for new domain types.
- Enums as `as const` objects for fixed value sets, matched with a derived `T`-prefixed type where needed — not TypeScript `enum`.
- Mongoose schema fields are camelCase; every schema uses `{ timestamps: true }`.
- Soft delete via an `isDeleted: boolean` field, filtered out with `pre("find")`/`pre("findOne")` query hooks (not yet present in the inherited `user.model.ts` — add this pattern to new Bike Log models that need soft delete, and remember `.aggregate()` calls bypass these hooks and need an explicit `isDeleted: false` in `$match`).

## File Organization & Naming

- One directory per resource under `src/app/modules/<name>/`, files named `<domain>.<layer>.ts`: `route`, `controller`, `service`, `model`, `interface`, `validation`, `constant`.
- Cross-cutting code lives in `src/app/middleware/`, `src/app/util/`, `src/app/Error/`, `src/app/config/`, `src/app/builder/` (generic query builder), `src/app/interface/` (shared global interfaces).

## Request/Response Conventions

- Controllers are thin: call the service, then `sendResponse(res, { status, success, message, data })`. Note the key is `status`, not `statusCode`. Business logic and Mongoose queries belong in the service, not the controller.
- Errors are thrown as `new AppError(httpStatus.<CODE>, "message")` and caught by `globalErrorHandler` — don't `res.status(...).json(...)` an error directly from inside a service/controller.
- Use the `http-status` package's named constants (`httpStatus.UNAUTHORIZED`, etc.) instead of raw numbers.

## Validation

- Request bodies are validated with Zod schemas in `*.validation.ts`, applied via the `validateRequest` middleware in the route definition (route chain, not inside the controller/service). `validateRequest` only validates `req.body` today — query/param validation, if ever needed, would have to be added separately.

## Auth & Password Hashing

- Password hashing uses **`argon2`** (`argon2.hash`/`argon2.verify`), not `bcrypt` — despite `bcrypt` also being listed in `package.json` dependencies (a boilerplate leftover), `argon2` is what's actually wired up in `user.model.ts`'s `pre("save")` hook. Follow `argon2` for any new password-handling code.
- JWTs are verified via `authCheck` with no role argument (see `architecture.md`) — Bike Log has one role. Authorization is ownership-based: check the resource's owner matches `req.user`'s id inside the service, not via a role check.

## Linting

`bikelog-server/eslint.config.mjs` enforces: `no-unused-vars: error`, `no-unused-expressions: error`, `prefer-const: error`, `no-console: warn`, `no-undef: error`, plus `@eslint/js` recommended and `typescript-eslint` recommended rule sets. Run `yarn lint` (or `yarn lint:fix`) before considering backend work done.

## Testing

There is no automated test suite — `yarn test` is a stub (`echo "Error: no test specified" && exit 1`), inherited from the cloned boilerplate. "Verification" for backend changes means a successful `yarn build` + clean `yarn lint`, plus manual verification of the affected endpoint (e.g. via curl/Postman) — not a test run.
