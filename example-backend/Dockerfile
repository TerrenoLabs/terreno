# Build stage
# TODO: Do this build in Github Actions
# 1.4.4 patches the Brotli decoder (CVE-2026-111497). `bun build --compile` embeds this binary.
FROM oven/bun:1.4.4 AS builder
WORKDIR /app

COPY . .

RUN bun install --frozen-lockfile --ignore-scripts
# Expo's exporter (Metro) requires a real Node runtime — bun's node shim cannot
# run it — so borrow node from the official image.
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
# Compile each package once and export the admin SPA from source at the same time.
# The runtime image serves that export at /console when ADMIN_SPA_ENABLED is set.
RUN sh scripts/ci/docker-compile-and-export.sh

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
# serve plugin at the copied export root (client/ + server/) explicitly.
ENV ADMIN_SPA_DIST_DIR=/app/admin-spa-dist
ENV MIGRATIONS_DIR=/app/migrations
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health" | grep -q '"healthy":true' || exit 1

RUN chown -R appuser:appuser /app
USER appuser

CMD ["./backend"]

