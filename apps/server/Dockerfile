# Build context = repo root (workspace install needs every package.json).
# Bun runs the TypeScript sources directly — no build step.
FROM oven/bun:1.3-slim

WORKDIR /app

COPY package.json bun.lock tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/e2e/package.json apps/e2e/package.json
COPY infra/package.json infra/package.json
COPY shared/package.json shared/package.json
RUN bun install --frozen-lockfile --production --ignore-scripts

COPY shared shared
COPY apps/server/src apps/server/src

ENV NODE_ENV=production
USER bun
EXPOSE 8787
CMD ["bun", "apps/server/src/main.ts"]
