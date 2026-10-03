# Build stage
# TODO: Do this build in Github Actions
FROM oven/bun:1 AS builder
WORKDIR /app

COPY . .

RUN bun install --frozen-lockfile --ignore-scripts
RUN bun run --filter "@terreno/api" compile
RUN bun run --filter "@terreno/api-health" compile
RUN bun run --filter "@terreno/blocks" compile
RUN bun run --filter "@terreno/ai" compile
RUN bun run --filter "@terreno/jobs" compile
RUN bun run --filter "@terreno/admin-backend" compile
RUN bun run --filter "@terreno/announcements" compile
RUN bun run --filter "@terreno/comms" compile
RUN bun run --filter "@terreno/feature-flags" compile
RUN bun run --filter "@terreno/ui" compile
RUN bun run --filter "@terreno/rtk" compile
RUN bun run --filter "@terreno/admin-frontend" compile
RUN bun run --filter "@terreno/admin-spa" compile

# Pre-build the admin SPA web export so the backend can serve it at /console
# (gated at runtime by ADMIN_SPA_ENABLED). Expo's exporter (Metro) requires a real
# Node runtime - bun's node shim cannot run it - so borrow node from the official image.
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
WORKDIR /app/admin-spa
# Workspace install hoists dependencies to /app/node_modules (see root bunfig.toml).
RUN node ../node_modules/expo/bin/cli export --platform web --output-dir dist
WORKDIR /app

WORKDIR /app/example-backend
RUN bun build --compile src/index.ts --outfile dist/backend

# Runtime stage
FROM debian:bookworm-slim
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/* \
  && useradd -r -u 1001 appuser

COPY --from=builder /app/example-backend/dist/backend ./backend
COPY --from=builder /app/admin-spa/dist ./admin-spa-dist
# Compiled binaries resolve import.meta.url to $bunfs. Copy migration files to a
# real path and point MIGRATIONS_DIR at it (same pattern as ADMIN_SPA_DIST_DIR).
COPY --from=builder /app/example-backend/migrations ./migrations

ENV NODE_ENV=production
ENV PORT=3000
# The compiled binary cannot resolve the SPA bundle via __dirname, so point the
# serve plugin at the copied export explicitly.
ENV ADMIN_SPA_DIST_DIR=/app/admin-spa-dist
ENV MIGRATIONS_DIR=/app/migrations
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health" | grep -q '"healthy":true' || exit 1

RUN chown -R appuser:appuser /app
USER appuser

CMD ["./backend"]

