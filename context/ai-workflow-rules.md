# AI Workflow Rules

## Overall Approach

This is a **greenfield build**, not a live/already-shipped codebase — unlike a mature project, there's no production traffic or existing users to avoid breaking. That said, don't take that as license to over-build: implement one module/feature at a time, following `context/specs/00-build-plan.md`'s order, and verify each before moving to the next. The current state is boilerplate cloned from `expense-tracker-server` (`transaction`/`user` modules) — expect to replace or heavily rework it, not build alongside it.

## Scoping Rules

1. **Follow the existing module split.** A new module gets route/controller/service/model/interface/validation/constant files matching the pattern in `context/architecture.md`, inside `src/app/modules/<name>/`. Don't invent a different structure.
2. **No speculative scaffolding.** Don't build out Phase-2 features (general maintenance/parts catalog beyond Engine Oil, push notifications, charts — see `context/project-overview.md`'s Out of Scope) before the MVP list is done, and don't add config/abstractions for hypothetical future needs.
3. **Don't add new core libraries/patterns without asking** — e.g. a different validation library instead of Zod, a different ORM, a different auth scheme, a testing framework, or reintroducing the unused `cloudinary`/`multer`/`nodemailer`/`openai` boilerplate deps for a feature that doesn't need them. The stack in `context/architecture.md` is intentional.
4. **Boilerplate cleanup is in-scope, not a detour.** Removing/renaming the inherited `transaction` module and adapting `user` are expected first steps (see `context/specs/00-build-plan.md`), not unrelated refactors to avoid.

## Handling Missing Requirements

- The source of truth for product requirements, data model, and API surface is `context/specs/bike-log-plan.md` — check it before guessing a field name, endpoint shape, or business rule.
- If an edge case isn't covered there (e.g. exact reminder "upcoming" buffer distance, or a category not yet listed), stop and ask rather than guessing the business rule.

## Protected / Sensitive Areas

- `src/app/config/index.ts` — its shape is read from multiple places; changing a key name is a breaking change across the codebase.
- `src/app.ts` — CORS origin allowlist and the middleware/error-handler ordering (`globalErrorHandler` must stay after routes, before the 404 handler). Don't reorder without understanding why.
- `src/app/router/index.ts` — the `routeArray` of registered module routers; new modules must be added here to be reachable.

## Documentation Sync

- If an implementation decision changes something documented in `architecture.md`, `code-standards.md`, or `project-overview.md` (a new module, a new invariant, a scope change), update that file in the same change.
- Update `context/progress-tracker.md` after each meaningful change.
- **Spec status tracking:** before starting implementation of any `context/specs/*.md` file, mark it **In Progress** in `progress-tracker.md`'s "Spec Implementation Status" table. Once fully implemented and verified, mark it **Complete**.

## Verification Checklist Before Moving On

- [ ] `yarn build` (TypeScript compile) succeeds.
- [ ] `yarn lint` is clean (no new errors/warnings).
- [ ] New/changed endpoints manually verified (curl or similar) against the expected request/response shape from `bike-log-plan.md`.
- [ ] If the change touches a resource with an owner (`Bike`, `FuelLog`, `MaintenanceLog`), confirm the service checks ownership against `req.user` before returning/mutating it.
