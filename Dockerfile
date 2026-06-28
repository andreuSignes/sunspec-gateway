# syntax=docker/dockerfile:1.7
# =============================================================================
# SunSpec Modbus Gateway — multi-stage build
# =============================================================================
# Stage 1 (builder): install full deps + compile TypeScript.
# Stage 2 (production): install only production deps + copy built `dist/`,
# run as a non-root `nestjs` user (uid 1001).
#
# Base image: node:24-alpine — matches .nvmrc and `engines.node: ">=24"`.
# pnpm is activated via corepack from the `packageManager` field in
# package.json — no version pinning needed here.
# =============================================================================

# --- builder stage ---------------------------------------------------------
FROM node:24-alpine AS builder
WORKDIR /app

# `corepack enable pnpm` reads `packageManager: "pnpm@11.0.0"` from
# package.json and activates that exact version on PATH.
RUN corepack enable pnpm

# Copy ONLY the manifest + lockfile first so the dependency layer caches
# independently of source changes (cache-friendly layer order).
COPY package.json pnpm-lock.yaml .npmrc ./

# Full install — we need devDependencies (typescript, ts-node) for the
# `pnpm build` step.
#
# `--ignore-scripts` skips lifecycle hooks (notably `husky install`,
# which would fail because the build context has no `.git/`). We don't
# need any postinstall scripts inside the image — `modbus-serial`'s
# native build is intentionally skipped via `optional=false` in `.npmrc`.
RUN pnpm install --frozen-lockfile --ignore-scripts

# Now copy the rest of the source.
COPY tsconfig.json ./
COPY src ./src

# Compile to `dist/` per `tsconfig.json` (`outDir: ./dist`).
RUN pnpm build

# Prune devDependencies so the production stage copies a clean tree.
RUN pnpm prune --prod --ignore-scripts


# --- production stage -------------------------------------------------------
FROM node:24-alpine AS production
WORKDIR /app

# Same pnpm activation as the builder.
RUN corepack enable pnpm

ENV NODE_ENV=production \
    # Help `pnpm` skip the optional native build (serialport@13) inside
    # the container too — the gateway is TCP-only and never needs it.
    # Mirrors `.npmrc` and `pnpm-workspace.yaml` settings for parity.
    NPM_CONFIG_OPTIONAL=false

# Copy the pruned manifest + lockfile + .npmrc so the production install
# uses exactly the same dependency resolution as the builder.
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/.npmrc ./
COPY --from=builder /app/node_modules ./node_modules

# Belt-and-braces — the builder's `pnpm prune --prod --ignore-scripts`
# already trimmed devDependencies, but re-prune in case the COPY above
# picked up a layer that still had them. No-op if already clean.
RUN pnpm prune --prod --ignore-scripts

# Copy the compiled JS only — no TypeScript sources, no dev tooling.
COPY --from=builder /app/dist ./dist

# Non-root user. `adduser -S` is the Alpine equivalent of `--system`
# (no password, no home dir creation in some cases — that's fine for a
# stateless gateway). UID 1001 matches the GitHub Actions nonroot
# convention.
RUN addgroup -g 1001 nodejs \
 && adduser -S -u 1001 -G nodejs nestjs

# Make /app owned by nestjs so `corepack enable pnpm` can drop its shim
# cache without root. (corepack needs to write to `$HOME/.cache/node/corepack`.)
RUN chown -R nestjs:nodejs /app

USER nestjs

# /healthz on 3000 and Modbus TCP on 5020. The container's port-mapping
# is configured in docker-compose.yml.
EXPOSE 3000 5020

# Healthcheck against the in-app liveness probe. `wget --spider` does a
# HEAD-style request without writing the body. node:24-alpine ships busybox
# `wget` so no extra package install is needed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/healthz || exit 1

CMD ["node", "dist/main.js"]
