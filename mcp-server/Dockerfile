# Stage 1: Install dependencies and build
# 1.4.4 patches the Brotli decoder (CVE-2026-111497).
FROM oven/bun:1.4.4 AS builder
WORKDIR /app

COPY . .

RUN bun install --frozen-lockfile --ignore-scripts
RUN bun run --filter "@terreno/blocks" compile
RUN bun run --filter "@terreno/api" compile

# The server reads generated docs from mcp-server/src/docs. They are git-ignored, so a clean
# checkout lacks them, and a checkout that ran the mcp-server tests holds the one-component
# test fixture instead. Regenerate them here: @terreno/ui props for terreno_get_component_docs
# (TypeDoc writes demo/ui-types-documentation.json), the repository docs and retained
# versions for terreno_search_docs, and the package guidelines.
RUN bun run --filter "@terreno/ui" types \
  && test -s demo/ui-types-documentation.json
RUN cd mcp-server \
  && cp ../demo/ui-types-documentation.json src/docs/ui-types-documentation.json \
  && bun run sync-versioned-docs \
  && bun run sync-package-guidelines \
  && test -d src/docs/versioned/next

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
