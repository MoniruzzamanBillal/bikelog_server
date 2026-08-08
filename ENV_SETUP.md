# Environment & Secrets Setup — `bikelog_server`

Every environment variable this backend reads, where to get its value, and how to configure it in each of the 3 places it might need to live: your local `.env`, the Vercel project's Environment Variables, and (for the 2 CI-triggered ones) GitHub Actions repository secrets.

This is the full picture; if you only came here for the weekly-notification cron secrets, jump to [CRON_SECRET](#cron_secret) and [API_BASE_URL](#api_base_url-github-actions-secret-only).

## How `.env` works here

`src/app/config/index.ts` loads `.env` via `dotenv.config({ path: path.join(process.cwd(), ".env") })` at startup and re-exports every variable through one `config` object — every other file in the codebase imports `config` rather than reading `process.env` directly. `.env` itself is gitignored (confirmed in `.gitignore`) — it never gets committed, so a fresh clone or a new teammate needs every value below filled in by hand before `yarn dev` will work.

## Variables

| `.env` key              | Read as                        | Required for                                                                            | Where to get it                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`              | `config.node_env`              | Distinguishing dev/production behavior                                                  | You set it yourself — `development` locally, `production` on Vercel (Vercel sets this automatically on deploy).                                                                                                                                                                                                                                                                                                                                         |
| `PORT`                  | `config.port`                  | Which port `yarn dev` listens on locally                                                | You pick it — this repo's convention is `5000`. Not used on Vercel (serverless functions don't bind a port themselves).                                                                                                                                                                                                                                                                                                                                 |
| `DATABASE_URL`          | `config.database_url`          | MongoDB connection                                                                      | **MongoDB Atlas** → your cluster → **Connect** → **Drivers** → copy the connection string (`mongodb+srv://...`), then substitute in your real DB user's password and a database name. If you don't have an Atlas cluster yet, Atlas has a permanent free tier (M0) — create a project, a free cluster, a database user (Database Access), and whitelist your IP or `0.0.0.0/0` for serverless (Network Access) before the string will actually connect. |
| `JWT_ACCESS_SECRET`     | `config.jwt_secret`            | Signing/verifying login JWTs                                                            | Not obtained anywhere — invent a long random string yourself (e.g. `openssl rand -hex 32`). Anyone with this value could forge valid login tokens, so treat it like a password.                                                                                                                                                                                                                                                                         |
| `JWT_EXPIRES_IN`        | `config.jwt_expires_in`        | How long a login token stays valid                                                      | Optional — defaults to `"10d"` in code if unset. Only add this if you want a different expiry, e.g. `"7d"`, `"30d"`.                                                                                                                                                                                                                                                                                                                                    |
| `openRouterApiKey`      | `config.openRouterApiKey`      | The `ai` module (spending/mileage insight cards, bike chat) — via `openRouterClient.ts` | **openrouter.ai** → sign in → **Keys** (dashboard) → **Create Key**. OpenRouter has a free tier / free-model routing this codebase already relies on (`FREE_MODELS` fallback in `openRouterClient.ts`) — no paid plan required to get a working key. Note the exact casing: this one key is lowercase-first (`openRouterApiKey`), unlike every other key in this file — matches `config/index.ts` exactly, don't "fix" the casing when adding it.       |
| `CLOUDINARY_CLOUD_NAME` | `config.cloudinary_cloud_name` | Image/PDF uploads (receipts, service photos, bike documents, manual PDFs)               | **cloudinary.com** → sign up (free tier) → **Dashboard** → "Cloud name" is shown right at the top.                                                                                                                                                                                                                                                                                                                                                      |
| `CLOUDINARY_API_KEY`    | `config.cloudinary_api_key`    | Same as above                                                                           | Same Cloudinary **Dashboard** page, "API Key".                                                                                                                                                                                                                                                                                                                                                                                                          |
| `CLOUDINARY_API_SECRET` | `config.cloudinary_api_secret` | Same as above                                                                           | Same Cloudinary **Dashboard** page, "API Secret" (click "reveal").                                                                                                                                                                                                                                                                                                                                                                                      |
| `CRON_SECRET`           | `config.cronSecret`            | Authenticating the weekly-summary cron trigger (`POST /cron/weekly-summary`)            | Not obtained anywhere — invent a long random string yourself (e.g. `openssl rand -hex 32`). This is a shared password between your scheduled GitHub Actions job and this API; anyone who has it can trigger the endpoint, but the endpoint only sends notifications, it doesn't expose data, so the blast radius of a leak is low. Still, treat it like a secret. See [below](#cron_secret) for exactly where this value needs to be duplicated.        |

No paid tier is required for any of these — MongoDB Atlas, OpenRouter, and Cloudinary all have free tiers this project was built against, matching the "all free services" constraint used throughout this project's planning docs.

## How to configure each place

### 1. Local `.env` (for `yarn dev`)

Create/edit `bikelog_server/.env` (already gitignored) with all 9 keys from the table above, e.g.:

```
NODE_ENV=development
PORT=5000
DATABASE_URL=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/<dbname>
JWT_ACCESS_SECRET=<your-random-string>
JWT_EXPIRES_IN=10d
openRouterApiKey=<your-openrouter-key>
CLOUDINARY_CLOUD_NAME=<your-cloud-name>
CLOUDINARY_API_KEY=<your-cloudinary-key>
CLOUDINARY_API_SECRET=<your-cloudinary-secret>
CRON_SECRET=<your-random-string>
```

### 2. Vercel project → Environment Variables (for the deployed API)

This backend deploys as Vercel serverless functions (`vercel.json` → `dist/server.js`), so the deployed instance never reads your local `.env` — it needs every one of the same 9 variables set separately.

Vercel dashboard → your `bikelog_server` project → **Settings → Environment Variables** → add each key/value pair from the table above (same values as your local `.env`, or your real production DB/keys if you use separate dev/prod credentials). Apply to at least the **Production** environment; add to Preview/Development too if you want branch deploys to also work end-to-end. Redeploy (or it applies automatically on the next deploy) for changes to take effect.

### 3. GitHub Actions repository secrets (for the 2 scheduled/CI workflows)

Two separate workflows need secrets — they're unrelated to each other and to the `.env`/Vercel values above, even though `CRON_SECRET`'s _value_ needs to match what's in Vercel.

**`deploy.yml`** (deploys to Vercel on every push to `master`) needs `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` — already fully documented, including exact click-by-click steps to obtain each one, in ` ci cd guideline bikelog/cd guideLineForBikelog/backend/README.md` (Part 2) — follow that doc rather than duplicating it here; those 3 are unrelated to the notification feature.

**`weekly-summary-cron.yml`** (fires the weekly bike-summary push notification) needs 2 secrets:

| Secret name    | Where it comes from                                                                                                                                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CRON_SECRET`  | **Same exact value** you put in `.env`/Vercel above — this is what lets the workflow's request past the `x-cron-secret` header check in `notification.controller.ts`.                                                                                                        |
| `API_BASE_URL` | Your deployed API's base URL + `/api`, e.g. `https://your-bikelog-server.vercel.app/api` — copy the domain from the Vercel dashboard's project overview (same shape as the Postman collection's `baseUrl` variable, just pointed at production instead of `localhost:5000`). |

Add both via GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**, same screen used for the 3 Vercel ones above.

## Quick-start checklist

- [ ] MongoDB Atlas cluster created, `DATABASE_URL` copied.
- [ ] `JWT_ACCESS_SECRET` generated.
- [ ] OpenRouter API key created.
- [ ] Cloudinary account created, 3 credentials copied.
- [ ] `CRON_SECRET` generated.
- [ ] All 9 keys added to local `.env`.
- [ ] All 9 keys added to Vercel → Environment Variables, project redeployed.
- [ ] `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` added as GitHub secrets (see the CI/CD guideline README linked above).
- [ ] `CRON_SECRET` (same value as `.env`/Vercel) + `API_BASE_URL` added as GitHub secrets.
- [ ] Test the cron endpoint once, before waiting for the Friday schedule: `curl -X POST https://<your-domain>/api/cron/weekly-summary -H "x-cron-secret: <your-CRON_SECRET>"`, or trigger `weekly-summary-cron.yml` manually via GitHub's Actions tab (**Run workflow** button).
