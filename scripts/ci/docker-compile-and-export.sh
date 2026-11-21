#!/bin/sh
# One image build: compile each package once (the old Dockerfile recompiled
# the same deps from every package script) and export the admin SPA from
# source at the same time. `bun build --compile` follows package exports into
# dist, so it runs after compile finishes.
set -eu
cd /app

# `bun run --filter` starts each package after the workspace packages it depends on, so
# order here does not matter (for example @terreno/jobs finishes before @terreno/ai). Every
# @terreno/* package that a listed package imports must be in the list, because
# TERRENO_SKIP_WORKSPACE_DEPS=1 stops each compile from building its own deps.
filters=""
for pkg in \
  @terreno/test \
  @terreno/api \
  @terreno/api-health \
  @terreno/blocks \
  @terreno/jobs \
  @terreno/ai \
  @terreno/admin-backend \
  @terreno/announcements \
  @terreno/comms \
  @terreno/feature-flags \
  @terreno/ui \
  @terreno/syncdb \
  @terreno/admin-frontend \
  @terreno/admin-spa
do
  filters="$filters --filter $pkg"
done

# shellcheck disable=SC2086
sh /app/scripts/ci/run-logged-parallel.sh \
  "compile=TERRENO_SKIP_WORKSPACE_DEPS=1 bun run $filters compile" \
  "export=cd /app/admin-spa && TERRENO_METRO_FROM_SOURCE=1 node /app/node_modules/expo/bin/cli export --platform web --output-dir dist"

cd /app/example-backend
bun build --compile src/index.ts --outfile dist/backend
