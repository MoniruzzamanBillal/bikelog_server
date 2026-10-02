# Environment & Secrets Setup — `bikelog_server`

Every environment variable this backend reads, where to get its value, and how to configure it in each of the 3 places it might need to live: your local `.env`, the Vercel project's Environment Variables, and (for the 2 CI-triggered ones) GitHub Actions repository secrets.

> **Corrected 2026-10-01**: this file previously described `DATABASE_URL` as a MongoDB Atlas connection string, which it has not been since the Postgres/Prisma migration merged (PR #20). The authoritative list of what the code actually reads is `src/app/config/index.ts`, plus `prisma.config.ts` for the migration-only variable.

This is the full picture; if you only came here for the weekly-notification cron secrets, jump to [CRON_SECRET](#cron_secret) and [API_BASE_URL](#api_base_url-github-actions-secret-only).

## How `.env` works here

`src/app/config/index.ts` loads `.env` via `dotenv.config({ path: path.join(process.cwd(), ".env") })` at startup and re-exports every variable through one `config` object — every other file in the codebase imports `config` rather than reading `process.env` directly. `.env` itself is gitignored (confirmed in `.gitignore`) — it never gets committed, so a fresh clone or a new teammate needs every value below filled in by hand before `yarn dev` will work.

## Variables

| `.env` key              | Read as                        | Required for                                                                            | Where to get it                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`              | `config.node_env`              | Distinguishing dev/production behavior                                                  | You set it yourself — `development` locally, `production` on Vercel (Vercel sets this automatically on deploy).                                                                                                                                                                                                                                                                                                                                         |
| `PORT`                  | `config.port`                  | Which port `yarn dev` listens on locally                                                | You pick it — this repo's convention is `5000`. Not used on Vercel (serverless functions don't bind a port themselves).                                                                                                                                                                                                                                                                                                                                 |
| `DATABASE_URL`          | `config.database_url`          | The live Postgres connection (Prisma runtime client)                                    | **Neon** → your project → **Connect** → copy the **pooled** connection string (`postgresql://...-pooler...neon.tech/...?sslmode=require`). ⚠️ `src/app/lib/prisma.ts` uses the `PrismaNeon` adapter, which talks to Neon over a WebSocket — this **cannot be a local Postgres instance**; pointing it at `localhost` fails on the first query with an opaque `ErrorEvent` rather than a clean connection error. For local dev, create a Neon branch and use its URL. |
| `DATABASE_URL_UNPOOLED` | read by `prisma.config.ts`     | `prisma migrate` / `prisma db push` (schema work only, not runtime)                      | Same Neon **Connect** panel → the **direct/unpooled** string (no `-pooler` in the host). `prisma.config.ts` points the migration engine at this var specifically — the migration engine needs a direct connection, so `yarn db:migrate` fails or hangs against the pooled URL. Not read through `config/index.ts`. |
| `JWT_ACCESS_SECRET`     | `config.jwt_secret`            | Signing/verifying login JWTs                                                            | Not obtained anywhere — invent a long random string yourself (e.g. `openssl rand -hex 32`). Anyone with this value could forge valid login tokens, so treat it like a password.                                                                                                                                                                                                                                                                         |
| `JWT_EXPIRES_IN`        | `config.jwt_expires_in`        | How long a login token stays valid                                                      | Optional — defaults to `"10d"` in code if unset. Only add this if you want a different expiry, e.g. `"7d"`, `"30d"`.                                                                                                                                                                                                                                                                                                                                    |
| `openRouterApiKey`      | `config.openRouterApiKey`      | The `ai` module (spending/mileage insight cards, bike chat) — via `openRouterClient.ts` | **openrouter.ai** → sign in → **Keys** (dashboard) → **Create Key**. OpenRouter has a free tier / free-model routing this codebase already relies on (`FREE_MODELS` fallback in `openRouterClient.ts`) — no paid plan required to get a working key. Note the exact casing: this one key is lowercase-first (`openRouterApiKey`), unlike every other key in this file — matches `config/index.ts` exactly, don't "fix" the casing when adding it.       |
| `CLOUDINARY_CLOUD_NAME` | `config.cloudinary_cloud_name` | Image/PDF uploads (receipts, service photos, bike documents, manual PDFs)               | **cloudinary.com** → sign up (free tier) → **Dashboard** → "Cloud name" is shown right at the top.                                                                                                                                                                                                                                                                                                                                                      |
| `CLOUDINARY_API_KEY`    | `config.cloudinary_api_key`    | Same as above                                                                           | Same Cloudinary **Dashboard** page, "API Key".                                                                                                                                                                                                                                                                                                                                                                                                          |
| `CLOUDINARY_API_SECRET` | `config.cloudinary_api_secret` | Same as above                                                                           | Same Cloudinary **Dashboard** page, "API Secret" (click "reveal").                                                                                                                                                                                                                                                                                                                                                                                      |
| `CRON_SECRET`           | `config.cronSecret`            | Authenticating **both** cron triggers (`POST /api/cron/weekly-summary`, `POST /api/cron/cleanup-error-logs`) | Not obtained anywhere — invent a long random string yourself (e.g. `openssl rand -hex 32`). This is a shared password between your scheduled GitHub Actions job and this API; anyone who has it can trigger the endpoint, but the endpoint only sends notifications, it doesn't expose data, so the blast radius of a leak is low. Still, treat it like a secret. See [below](#cron_secret) for exactly where this value needs to be duplicated.        |
| `EXPENSE_TRACKER_BASE_URL` | `config.expenseTrackerBaseUrl` | Spec 30's outbound spend sync into the developer's separate `expenseTracker2` project | That project's own deployed API base URL. Optional in the sense that the sync is fire-and-forget — if unset, `notifyExpenseTracker` simply fails and logs via `errorLog`; it never blocks or fails this server's own response. |
| `EXPENSE_TRACKER_INTEGRATION_KEY` | `config.expenseTrackerIntegrationKey` | Same as above | Shared secret agreed with `expenseTracker2`'s `POST /api/transaction-requests/ingest` endpoint — see that project's `server/ai context/specs/07-bikelog-transaction-request-sync.md`. |

`MONGO_DATABASE_URL` is also still read by `config/index.ts` (`config.mongo_database_url`) but is **vestigial** — a leftover of the MongoDB→Postgres migration, used by nothing on the live boot path. Only `src/scripts/migratePhase8MongoToPostgres.ts`, the already-completed one-off cutover script, would need it.

No paid tier is required for any of these — Neon, OpenRouter, and Cloudinary all have free tiers this project was built against, matching the "all free services" constraint used throughout this project's planning docs.

## How to configure each place

### 1. Local `.env` (for `yarn dev`)

Create/edit `bikelog_server/.env` (already gitignored) with the keys from the table above, e.g.:

```
NODE_ENV=development
PORT=5000
DATABASE_URL=postgresql://<user>:<password>@<endpoint>-pooler.<region>.aws.neon.tech/<db>?sslmode=require
DATABASE_URL_UNPOOLED=postgresql://<user>:<password>@<endpoint>.<region>.aws.neon.tech/<db>?sslmode=require
JWT_ACCESS_SECRET=<your-random-string>
JWT_EXPIRES_IN=10d
openRouterApiKey=<your-openrouter-key>
CLOUDINARY_CLOUD_NAME=<your-cloud-name>
CLOUDINARY_API_KEY=<your-cloudinary-key>
CLOUDINARY_API_SECRET=<your-cloudinary-secret>
CRON_SECRET=<your-random-string>
EXPENSE_TRACKER_BASE_URL=<expenseTracker2-api-base-url>
EXPENSE_TRACKER_INTEGRATION_KEY=<shared-secret>
```

### 2. Vercel project → Environment Variables (for the deployed API)

This backend deploys as Vercel serverless functions (`vercel.json` → `dist/server.js`), so the deployed instance never reads your local `.env` — it needs the same variables set separately.

Vercel dashboard → your `bikelog_server` project → **Settings → Environment Variables** → add each key/value pair from the table above (same values as your local `.env`, or your real production DB/keys if you use separate dev/prod credentials). Apply to at least the **Production** environment; add to Preview/Development too if you want branch deploys to also work end-to-end. Redeploy (or it applies automatically on the next deploy) for changes to take effect.

### 3. GitHub Actions repository secrets (for the 2 scheduled/CI workflows)

Two separate workflows need secrets — they're unrelated to each other and to the `.env`/Vercel values above, even though `CRON_SECRET`'s _value_ needs to match what's in Vercel.

**`deploy.yml`** (deploys to Vercel on every push to `master`) needs `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` — obtained from the Vercel dashboard (**Account Settings → Tokens** for the token; **Project Settings → General** for the org/project ids). These were previously documented in a `guideLineForBikelog/` folder that has since been **deleted** from the repo root — that path no longer exists, so don't go looking for it. The live workflow definitions are the reference: see `.github/workflows/deploy.yml`.

**`weekly-summary-cron.yml`** (Thursday 22:00 Asia/Dhaka / 16:00 UTC — fires the weekly bike-summary push notification) and **`daily-error-log-cleanup.yml`** (03:00 Asia/Dhaka / 21:00 UTC daily — deletes `error_logs` rows older than 30 days, the Postgres-native replacement for Mongo's TTL-index sweep) share the same 2 secrets between them:

| Secret name    | Where it comes from                                                                                                                                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CRON_SECRET`  | **Same exact value** you put in `.env`/Vercel above — this is what lets each workflow's request past the `x-cron-secret` header check (`notification.controller.ts`, `errorLog.controller.ts`).                                                                                                        |
| `API_BASE_URL` | Your deployed API's base URL + `/api`, e.g. `https://your-bikelog-server.vercel.app/api` — copy the domain from the Vercel dashboard's project overview (same shape as the Postman collection's `baseUrl` variable, just pointed at production instead of `localhost:5000`). |

Add both via GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**, same screen used for the 3 Vercel ones above.

## Quick-start checklist

- [ ] Neon project created; **pooled** `DATABASE_URL` and **unpooled** `DATABASE_URL_UNPOOLED` both copied.
- [ ] `JWT_ACCESS_SECRET` generated.
- [ ] OpenRouter API key created.
- [ ] Cloudinary account created, 3 credentials copied.
- [ ] `CRON_SECRET` generated.
- [ ] `EXPENSE_TRACKER_BASE_URL` / `EXPENSE_TRACKER_INTEGRATION_KEY` obtained from the `expenseTracker2` side (skip if you don't want the spend sync).
- [ ] All keys added to local `.env`.
- [ ] All keys added to Vercel → Environment Variables, project redeployed — **confirm `DATABASE_URL` points at the Neon instance the Phase 8 migration actually populated**, not an empty or local DB.
- [ ] `yarn db:migrate` run once against the target database.
- [ ] `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` added as GitHub secrets (see the CI/CD guideline README linked above).
- [ ] `CRON_SECRET` (same value as `.env`/Vercel) + `API_BASE_URL` added as GitHub secrets.
- [ ] Test the cron endpoint once, before waiting for the Thursday schedule: `curl -X POST https://<your-domain>/api/cron/weekly-summary -H "x-cron-secret: <your-CRON_SECRET>"`, or trigger `weekly-summary-cron.yml` manually via GitHub's Actions tab (**Run workflow** button).
