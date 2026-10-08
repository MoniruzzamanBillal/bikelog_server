# Base image is node:22-slim (Debian), not alpine, on purpose. `argon2` is live code here
# (password hashing in src/app/modules/user/user.services.ts) and does ship a musl prebuild,
# but `bcrypt@5.1.1` installs via `node-pre-gyp install --fallback-to-build`, which on musl
# can fall through to compiling from source and would need python3/make/g++ in the image.
# Debian gets reliable glibc prebuilds for both with no build toolchain at all.
# Trade-off: slim ships neither wget nor curl, so the compose healthcheck probes with node.


# ---- Stage 1: deps ----
# Installs dependencies only. Cached independently of source changes — this layer re-runs
# only when package.json, yarn.lock or the Prisma schema actually change.
#
# NOTE the COPY order, it is load-bearing: package.json declares
# "postinstall": "prisma generate", which reads prisma/schema.prisma via prisma.config.ts
# (resolved against cwd). Both must already be present or `yarn install` fails outright.
FROM node:22-slim AS deps
WORKDIR /app

# node:22-slim ships libssl3 but not the `openssl` package itself, and without it Prisma
# cannot detect the libssl version — it warns and falls back to an "openssl-1.1.x" engine:
#   "Prisma failed to detect the libssl/openssl version to use, and may not work as
#    expected. Defaulting to openssl-1.1.x"
# Observed for real on this image before this line existed. Runtime queries go through the
# PrismaNeon driver adapter and are unaffected, but the schema engine `prisma migrate` uses
# is, so install it rather than rely on the fallback.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

COPY package.json yarn.lock prisma.config.ts ./
COPY prisma ./prisma

# prisma.config.ts calls env("DATABASE_URL_UNPOOLED"), and Prisma 7 resolves that EAGERLY
# when it loads the config file — so `prisma generate` aborts with
# "PrismaConfigEnvError: Cannot resolve environment variable" even though generate never
# opens a connection (the schema's datasource block carries no `url`). This placeholder
# exists only to let the config file load. It is build-scoped (ARG, not ENV), never
# reaches the final stage, and is never dialled: the real pooled/unpooled URLs are
# supplied at runtime through env_file. Do NOT put a real credential here.
ARG DATABASE_URL_UNPOOLED="postgresql://placeholder:placeholder@localhost:5432/placeholder?sslmode=disable"

RUN yarn install --frozen-lockfile


# ---- Stage 2: builder ----
# Compiles TypeScript to dist/ (tsconfig: rootDir ./src, outDir ./dist, entry dist/server.js).
FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN yarn build


# ---- Stage 3: runner (final image) ----
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Needed here as well as in `deps`, not just there: `prisma migrate` runs in THIS stage
# (via docker compose exec), and its schema engine is what links libssl. Installing it
# only in deps left the "failed to detect the libssl/openssl version" warning in place —
# verified by running `prisma migrate status` in the container.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

# This line is load-bearing. src/app/config/index.ts reads process.env.PORT with NO
# fallback, and src/server.ts calls app.listen(config.port, cb). With PORT unset,
# app.listen(undefined) makes Node bind a random ephemeral port and log "listening from
# port undefined" — the container would start, exit code 0, report healthy, and be
# unreachable on the port we publish.
ENV PORT=5000

# Non-root user. groupadd/useradd here, not alpine's addgroup/adduser.
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs api

# node_modules is taken from `deps` wholesale rather than re-installed with --production.
# Two reasons: the Prisma client generates into node_modules/.prisma/client (the generator
# declares no custom `output`, so a fresh --production install without a generate step
# would leave it missing and fail at runtime), and typescript plus the prisma CLI live in
# `dependencies` in this repo anyway, so --production would prune almost nothing.
COPY --from=deps --chown=api:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=api:nodejs /app/dist ./dist

# prisma/, prisma.config.ts and package.json ship so a migration can be run DELIBERATELY:
#   docker compose exec local yarn db:migrate
# Migrations are never run on container start — see the project CLAUDE.md for why.
COPY --from=builder --chown=api:nodejs /app/prisma ./prisma
COPY --from=builder --chown=api:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=api:nodejs /app/package.json ./package.json

USER api

EXPOSE 5000

CMD ["node", "dist/server.js"]
