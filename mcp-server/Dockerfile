# Stage 1: Install dependencies and build
# 1.4.4 patches the Brotli decoder (CVE-2026-111497).
FROM oven/bun:1.4.4 AS builder
WORKDIR /app

COPY . .

RUN bun install --frozen-lockfile --ignore-scripts
RUN bun run --filter "@terreno/blocks" compile
RUN bun run --filter "@terreno/api" compile

# Stage 2: Runtime stays on Bun so Sentry/OpenTelemetry instrumentation works.
# 1.4.4 patches the Brotli decoder (CVE-2026-111497).
FROM oven/bun:1.4.4
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/api ./api
COPY --from=builder /app/blocks ./blocks
COPY --from=builder /app/mcp-server ./mcp-server
COPY --from=builder /app/package.json ./package.json

ENV NODE_ENV=production
WORKDIR /app/mcp-server

CMD ["bun", "run", "src/index.ts"]
