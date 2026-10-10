# Spec 47 — Dockerize `bikelog_server`

**Status:** Complete (2026-10-08)
**Scope:** tooling only. No runtime, API, schema or business-logic path was changed.

## Why

The server only ever ran two ways: `yarn dev` on a developer machine, or as a Vercel
serverless function via `vercel.json`. There was no reproducible way to run the compiled
build the way production runs it. The developer had already dockerized a frontend in
another project and wanted the same house style extended to this backend.

The web client half is `bikelog_client-web-` spec 31; the two were done together but
commit separately, per the per-repo rule.

## What shipped

| File | Purpose |
| --- | --- |
| `Dockerfile` | 3-stage `deps` → `builder` → `runner`, non-root, `node:22-slim` |
| `.dockerignore` | new |
| `docker-compose.yml` | one `local` service, `5000:5000` |
| `.env.example` | committed env template (required a `!.env.example` negation in `.gitignore`) |
| `.env` | key-spacing normalised, `NODE_ENV` typo fixed, `CRON_SECRET` added |

Run it with:

```bash
docker compose up local -d --build
```

## Decisions, and the evidence behind them

### `node:22-slim`, not alpine

`argon2` is live code (`user.services.ts:26,70`) and does ship
`prebuilds/linux-x64/argon2.musl.node`, so argon2 alone would run on alpine. The blocker is
`bcrypt@5.1.1`, which installs through `node-pre-gyp install --fallback-to-build` and
publishes glibc prebuilds only — on musl it falls back to compiling, needing
`python3 make g++` in the image. **`bcrypt` is dead code here** (`grep -rn bcrypt src/`
returns nothing; only `argon2` is imported), so Debian avoids a toolchain layer and a
node-gyp compile on every cold build for a dependency nothing uses.

Follow-up worth doing: drop `bcrypt` from `dependencies`, and the server could move to
alpine and match the web image.

Cost of slim: no `wget`/`curl`, so the healthcheck uses a `node -e` http probe.

### The COPY order in `deps` is load-bearing — and `prisma.config.ts` broke the first build

`package.json` declares `"postinstall": "prisma generate"`, so `yarn install` ends by
invoking the Prisma CLI, which needs `prisma/schema.prisma` already on disk.

That much was expected. What was not: **`prisma.config.ts` calls `env("DATABASE_URL_UNPOOLED")`,
and Prisma 7 resolves that eagerly when it loads the config file** — on *every* CLI command
including `generate`, which never opens a connection. The first build failed with:

```
Failed to load config file "/app" as a TypeScript/JavaScript module.
Error: PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL_UNPOOLED.
```

Fixed with a build-scoped `ARG DATABASE_URL_UNPOOLED` placeholder in the `deps` stage. It
is never dialled (the schema's datasource block has no `url`), never reaches the final
stage, and is not a secret. `--ignore-scripts` was rejected as an alternative: it would
also skip `@prisma/engines`' postinstall, leaving no schema engine and therefore no way to
run `yarn db:migrate` at all.

### `ENV PORT=5000` prevents a silent unreachable container

`src/app/config/index.ts` reads `process.env.PORT` with **no fallback**, and `server.ts`
calls `app.listen(config.port, cb)`. With `PORT` unset, `app.listen(undefined)` binds a
random ephemeral port and logs `listening from port undefined` — the container starts, exits
0 on nothing, reports healthy, and answers on no published port. Pinned in both the
Dockerfile and compose on purpose.

`app.listen` passes no host argument, so it already binds the wildcard address. No
`HOSTNAME` workaround is needed here (unlike the Next client — see web spec 31).

### `node_modules` is copied whole into the runner

`prisma generate` declares no custom `output`, so the client lands in
`node_modules/.prisma/client`. A fresh `--production` install without a generate step
would leave it missing and fail at runtime. And `typescript`, the `prisma` CLI and every
`@types/*` package sit in `dependencies` in this repo, so `--production` would prune almost
nothing anyway.

### `openssl` in **both** `deps` and `runner`

`node:22-slim` ships `libssl3` but not the `openssl` package, and without it Prisma warns
`failed to detect the libssl/openssl version to use ... Defaulting to "openssl-1.1.x"`.
Installing it in `deps` alone was not enough — `prisma migrate` runs in the **runner**, so
the warning survived until it was installed there too. Verified by running
`prisma migrate status` in the container before and after.

### `TZ: Asia/Dhaka`

Containers default to UTC; this machine and the app's domain are Asia/Dhaka (UTC+6, no DST
— `notification.utils.ts:1` says so). `spending.service.ts:231` and
`mileageRecord.service.ts:254` both bucket months with
`new Date(now.getFullYear(), now.getMonth() - i, 1)` — **local** time. Under UTC the first
six hours of each Dhaka day resolve to the previous UTC day, silently shifting the "last N
months" trend windows. Confirmed live: host `Asia/Dhaka`, container `UTC` before the pin.

### No `postgres` service, no volumes

`src/app/lib/prisma.ts` drives Prisma through the `PrismaNeon` WebSocket adapter, which
cannot talk to a local Postgres. `DATABASE_URL` points at the real Neon host. And no code
path writes to the filesystem at runtime — all three upload middlewares use multer
`memoryStorage` or stream straight to Cloudinary — so no volume is needed.

### Memory limit 1.5G, not the house 512M

All uploads are buffered in RSS, and `bikeDocument.route.ts` is
`uploadDocument.array("files", 10)` with a 20MB per-file limit — up to 200MB of raw Buffers
for one request, plus Cloudinary stream copies, plus `pdf-parse` expanding a 20MB PDF. Those
Buffers are off-heap, so they count straight against the cgroup limit. A limit is a cap,
not a reservation, so it costs nothing at idle.

### Migrations are deliberately NOT run on startup

There is no entrypoint script and no `prisma migrate deploy` in `CMD`. Migrations in this
project are applied by hand and `deploy.yml` does not run them. The image ships `prisma/`,
`prisma.config.ts` and `package.json` only so a migration can be run explicitly:

```bash
docker compose exec local yarn db:migrate     # applies
docker compose exec local npx prisma migrate status   # read-only
```

## Verification performed

| Check | Result |
| --- | --- |
| `docker compose build` | clean after the `prisma.config.ts` fix |
| `listening from port 5000` in logs | yes — not `undefined` |
| `GET /` from host | `200 {"message":"server is running  !! "}` |
| compose healthcheck | `healthy` |
| **Neon connectivity** | `POST /api/auth/login` with a bogus email returns `404 "User dont exist with this email !!!"` — the service ran a real `user` query against Neon through the container |
| `argon2` native binding | `require("argon2").hash()` inside the container returns a 97-char hash |
| `prisma migrate status` in container | `4 migrations found` / `Database schema is up to date!`, no OpenSSL warning |
| no migrations on boot | `docker compose logs` contains no migration output |
| `TZ` | `Asia/Dhaka`, `GMT+0600` |
| CORS preflight from `http://localhost:3000` and `:3001` | `204` + matching `Access-Control-Allow-Origin` with `Allow-Credentials: true` |
| non-Docker regression | `yarn build` clean, `yarn lint` 0 errors / 23 pre-existing warnings — unchanged |

Not verified: a logged-in session with real credentials, and any upload path through the
container (Cloudinary egress). Both need the developer's own credentials.

## Incidental finding, recorded not fixed

`GET /` returns 200 without touching the database, and `server.ts`'s `Main()` only
`console.log`s a `prisma.$connect()` failure — leaving the process alive with exit code 0.
So the healthcheck is a **liveness** probe only: a container with a broken `DATABASE_URL`
would report healthy while every data route 500s, and `restart: unless-stopped` would never
fire. A real `/api/health` readiness route running `SELECT 1` would close this. Out of
scope here; worth its own spec.
