# --- builder ------------------------------------------------------------
FROM node:22-bookworm-slim AS builder
WORKDIR /repo
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

# Copy lockfile + workspace metadata first for cache efficiency.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/ingest/shared/package.json ./packages/ingest/shared/package.json
COPY packages/ingest/federal/package.json ./packages/ingest/federal/package.json

RUN pnpm install --frozen-lockfile --filter @au/web... --filter @au/db...

# Now copy sources and build.
COPY tsconfig.base.json ./
COPY apps/web ./apps/web
COPY packages ./packages

RUN pnpm --filter @au/web build

# --- runner -------------------------------------------------------------
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

# Standalone output bundles every workspace dep it needs.
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static

EXPOSE 8080
USER node
CMD ["node", "apps/web/server.js"]
