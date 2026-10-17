#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <demo|frontend|docs> <production|preview> [alias]" >&2
  exit 2
fi

target="$1"
mode="$2"
alias_name="${3:-}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

case "$target" in
  demo)
    site_id="${NETLIFY_DEMO_SITE_ID:-}"
    site_name="terreno-demo"
    netlify_filter="terreno-demo"
    deployment_env="demo"
    ;;
  frontend)
    site_id="${NETLIFY_FRONTEND_EXAMPLE_SITE_ID:-}"
    site_name="terreno-frontend"
    netlify_filter="@terreno/example-frontend"
    deployment_env="example-frontend"
    ;;
  docs)
    site_id="${NETLIFY_DOCS_SITE_ID:-}"
    site_name="terreno-docs"
    netlify_filter="@terreno/website"
    deployment_env="docs"
    ;;
  *)
    echo "Unknown Netlify target: $target" >&2
    exit 2
    ;;
esac

if [ "$mode" = "preview" ] && [ -z "$alias_name" ]; then
  echo "Preview deploy requires an alias" >&2
  exit 2
fi
if [ "$mode" != "production" ] && [ "$mode" != "preview" ]; then
  echo "Unknown Netlify deploy mode: $mode" >&2
  exit 2
fi

export NETLIFY_SITE_ID="$site_id"
if [ -z "${NETLIFY_AUTH_TOKEN:-}" ] || [ -z "${NETLIFY_SITE_ID:-}" ]; then
  echo "Cannot run Netlify ${target} ${mode} deploy: terreno-netlify is missing NETLIFY_AUTH_TOKEN or the site id." >&2
  exit 1
fi

case "$target" in
  demo)
    bun run --filter '@terreno/blocks' --filter '@terreno/ui' compile
    bun run --filter '@terreno/ui' types
    (cd demo && bun run export)
    bash demo/scripts/fix-netlify-assets.sh demo/dist
    publish_dir="demo/dist"
    ;;
  frontend)
    export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"
    node .github/scripts/compile-workspace-deps.js example-frontend admin-frontend api ai
    bun run --filter '@terreno/admin-frontend' --filter '@terreno/api' --filter '@terreno/ai' compile
    prod_url="https://prod---terreno-backend-example-7knxlrnpqq-uc.a.run.app"
    api_url="${EXPO_PUBLIC_API_URL:-$prod_url}"
    jq --arg url "$api_url" \
      '.expo.extra.BASE_URL = $url | .expo.extra.apiBaseUrl = $url' \
      example-frontend/app.json > example-frontend/app.json.tmp
    mv example-frontend/app.json.tmp example-frontend/app.json
    (cd example-frontend && bun run export)
    bash demo/scripts/fix-netlify-assets.sh example-frontend/dist
    printf '/*    /index.html   200\n' > example-frontend/dist/_redirects
    publish_dir="example-frontend/dist"
    ;;
  docs)
    bun run --filter '@terreno/blocks' --filter '@terreno/ui' compile
    bun run --filter '@terreno/ui' types
    (cd website && bun run generate:components && bun run generate:api)
    (
      cd website
      # Docusaurus sizes its SSG worker pool from the CPU count, which can report the
      # host's cores inside CI containers. Each worker loads the full server bundle.
      DOCUSAURUS_SSG_WORKER_THREAD_COUNT=1 \
        DOCS_PREVIEW="$([ "$mode" = "preview" ] && echo true || echo false)" \
        DEMO_URL=https://terreno-demo.netlify.app \
        bunx docusaurus build --no-minify
    )
    # Released versions are prebuilt once at release time; unpack them, don't rebuild.
    if [ "$mode" = "production" ]; then
      scripts/ci/docs-archive.sh fetch website/build
    fi
    publish_dir="website/build"
    ;;
esac

# gcp-cd-preview runs in a separate workflow; publish only once its backend answers.
if [ -n "${NETLIFY_WAIT_FOR_HEALTH_URL:-}" ]; then
  scripts/ci/wait-cloud-run-health.sh "$NETLIFY_WAIT_FOR_HEALTH_URL" 1200
fi

# netlify-cli sees the Bun workspace as a monorepo and refuses to guess a package in CI.
# Absolute --dir keeps the publish path independent of the filtered package's base dir.
# --no-build: this script already built publish_dir. Without it netlify-cli runs the root
# netlify.toml docs build (wipe node_modules, reinstall, full Docusaurus) on every deploy.
args=(deploy --no-build --filter "$netlify_filter" --dir "$repo_root/$publish_dir" --site "$NETLIFY_SITE_ID" --auth "$NETLIFY_AUTH_TOKEN")
if [ "$mode" = "production" ]; then
  args+=(--prod)
  deployment_url="https://${site_name}.netlify.app"
  deployment_description="${target} production deploy"
else
  args+=(--alias "$alias_name")
  # Aliases are pr-N (docs: docs-pr-N); GitHub environments are <env>-preview-pr-N.
  deployment_env="${deployment_env}-preview-pr-${alias_name##*pr-}"
  deployment_url="https://${alias_name}--${site_name}.netlify.app"
  deployment_description="${target} preview ${alias_name}"
fi

# shellcheck source=scripts/ci/github-deployment-lib.sh
source scripts/ci/github-deployment-lib.sh
with_github_deployment "$deployment_env" "$deployment_description" "$deployment_url" \
  bunx --bun netlify-cli@latest "${args[@]}"
