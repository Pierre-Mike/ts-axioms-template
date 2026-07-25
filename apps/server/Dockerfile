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

# Writable data dir for the notes.io sqlite file, owned by the non-root `bun`
# user this container runs as (see USER below). Without this, the Notes
# layer's lazy `new Database(...)` throws "unable to open database file"
# against the root-owned /app tree on first request, and every route 500s.
RUN mkdir -p /app/data && chown -R bun:bun /app/data

ENV NODE_ENV=production
ENV NOTES_DB_PATH=/app/data/notes.sqlite
USER bun
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["bun", "-e", "process.exit((await fetch('http://localhost:8787/health').catch(() => null))?.ok ? 0 : 1)"]

CMD ["bun", "apps/server/src/main.ts"]
