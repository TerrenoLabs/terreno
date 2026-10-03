# Stage 1: Install dependencies and build
FROM oven/bun:1 AS builder
WORKDIR /app

COPY . .

RUN bun install --frozen-lockfile --ignore-scripts
RUN bun run --filter "@terreno/blocks" compile
RUN bun run --filter "@terreno/api" compile

# Stage 2: Runtime - use oven/bun:1 so Sentry/OpenTelemetry instrumentation works
FROM oven/bun:1
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/api ./api
COPY --from=builder /app/blocks ./blocks
COPY --from=builder /app/mcp-server ./mcp-server
COPY --from=builder /app/package.json ./package.json

ENV NODE_ENV=production
WORKDIR /app/mcp-server

CMD ["bun", "run", "src/index.ts"]
