#!/usr/bin/env bash
# Builds one app with `vercel build` and ships the prebuilt output to the terrenolabs Vercel
# team. Runs alongside the Netlify and Cloud Run deploys while the Vercel topology is
# evaluated; see docs/how-to/deploy-to-vercel.md.
set -euo pipefail

usage() {
  echo "Usage: $0 <backend|frontend|demo> <production|preview> [pr-number] [--plan]" >&2
  exit 2
}

plan_only=false
args=()
for arg in "$@"; do
  if [ "$arg" = "--plan" ]; then
    plan_only=true
  else
    args+=("$arg")
  fi
done
[ "${#args[@]}" -ge 2 ] || usage

target="${args[0]}"
mode="${args[1]}"
pr_number="${args[2]:-}"
VERCEL_CLI_VERSION="${VERCEL_CLI_VERSION:-62.7.0}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

case "$target" in
  backend) project_var="VERCEL_BACKEND_PROJECT_ID"; probe_path="/health" ;;
  frontend) project_var="VERCEL_FRONTEND_PROJECT_ID"; probe_path="/" ;;
  demo) project_var="VERCEL_DEMO_PROJECT_ID"; probe_path="/" ;;
  *) echo "Unknown Vercel target: $target" >&2; usage ;;
esac

case "$mode" in
  production)
    host="terrenolabs-${target}.vercel.app"
    backend_host="terrenolabs-backend.vercel.app"
    deployment_env="vercel-${target}"
    ;;
  preview)
    if ! [[ "$pr_number" =~ ^[0-9]+$ ]]; then
      echo "Preview deploy requires a numeric PR number (got '${pr_number}')" >&2
      exit 2
    fi
    # Fixed per-PR hosts let the frontend build against its backend before that exists.
    host="terrenolabs-${target}-pr-${pr_number}.vercel.app"
    backend_host="terrenolabs-backend-pr-${pr_number}.vercel.app"
    deployment_env="vercel-${target}-preview-pr-${pr_number}"
    ;;
  *) echo "Unknown Vercel deploy mode: $mode" >&2; usage ;;
esac

# Per-deployment runtime env layered over the project's Preview variables. A PR backend uses
# the PR database that the Cloud Run preview seeds and preview-cleanup drops.
runtime_env=()
if [ "$target" = "backend" ] && [ "$mode" = "preview" ]; then
  runtime_env+=(
    "MONGO_DB_NAME=terreno-example-pr-${pr_number}"
    # The Cloud Run preview seeds this database. The seed creates users through an in-process
    # supertest server, which cannot bind a port inside a Vercel Function.
    "SEED_DEFAULTS=false"
    "BETTER_AUTH_URL=https://${host}"
    # Exact origin only: vercel.app is a shared namespace, so a wildcard such as
    # terreno-frontend-*-terrenolabs.vercel.app can match another team's project.
    "CORS_ORIGINS=https://terrenolabs-frontend-pr-${pr_number}.vercel.app"
  )
fi

# Only the frontend build reads it, always from this deploy's backend host, so a PR frontend
# can never be built against another environment's backend.
api_url=""
if [ "$target" = "frontend" ]; then
  api_url="https://${backend_host}"
fi

if [ "$plan_only" = true ]; then
  echo "host=${host}"
  echo "deployment_env=${deployment_env}"
  echo "probe_url=https://${host}${probe_path}"
  [ -n "$api_url" ] && echo "api_url=${api_url}"
  for entry in ${runtime_env[@]+"${runtime_env[@]}"}; do
    echo "runtime_env=${entry}"
  done
  exit 0
fi

missing=()
for name in VERCEL_TOKEN VERCEL_ORG_ID "$project_var"; do
  if [ -z "${!name:-}" ]; then
    missing+=("$name")
  fi
done
if [ "${#missing[@]}" -ne 0 ]; then
  echo "Cannot run Vercel ${target} ${mode} deploy: missing ${missing[*]} (terreno-vercel context)." >&2
  exit 1
fi
# The CLI reads VERCEL_TOKEN, VERCEL_ORG_ID and VERCEL_PROJECT_ID from the environment, so no
# link file is needed and the token never lands on argv.
export VERCEL_PROJECT_ID="${!project_var}"

case "$target" in
  backend)
    node .github/scripts/compile-workspace-deps.js example-backend
    ;;
  frontend)
    node .github/scripts/compile-workspace-deps.js example-frontend admin-frontend api ai
    bun run --filter '@terreno/admin-frontend' --filter '@terreno/api' --filter '@terreno/ai' compile
    ;;
  demo)
    bun run --filter '@terreno/blocks' --filter '@terreno/ui' compile
    bun run --filter '@terreno/ui' types
    ;;
esac

vercel_env="$mode"
prod_flag=()
if [ "$mode" = "production" ]; then
  prod_flag=(--prod)
fi

# Runs the pinned CLI with no stdin and no prompts: a newer release makes the CLI ask
# "Would you like to upgrade now?", which otherwise hangs CI until its no-output timeout.
vercel_cli() {
  bunx "vercel@${VERCEL_CLI_VERSION}" "$@" --non-interactive </dev/null
}

deploy() {
  vercel_cli pull --yes "--environment=${vercel_env}"
  # The CLI's file trace parses the 45 MB backend bundle and exceeds Node's default heap.
  export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=6144"
  if [ -n "$api_url" ]; then
    EXPO_PUBLIC_API_URL="$api_url" vercel_cli build --yes ${prod_flag[@]+"${prod_flag[@]}"}
  else
    vercel_cli build --yes ${prod_flag[@]+"${prod_flag[@]}"}
  fi

  local env_flags=()
  for entry in ${runtime_env[@]+"${runtime_env[@]}"}; do
    env_flags+=(--env "$entry")
  done
  local result
  result="$(vercel_cli deploy --prebuilt --yes --format json \
    ${prod_flag[@]+"${prod_flag[@]}"} ${env_flags[@]+"${env_flags[@]}"})"
  local url
  url="$(jq -r '.deployment.url' <<<"$result")"
  echo "Deployed ${url}"

  if [ "$mode" = "preview" ]; then
    # `alias set` ignores VERCEL_ORG_ID and would look in the token owner's personal scope.
    vercel_cli alias set "$url" "$host" --scope "$VERCEL_ORG_ID"
  fi

  # The CLI reporting success is a claim about the build; the probe is the site answering.
  local deadline=$((SECONDS + 300))
  until curl -fsS -o /dev/null "https://${host}${probe_path}"; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "https://${host}${probe_path} did not answer 2xx within 5 minutes" >&2
      return 1
    fi
    sleep 10
  done
  echo "https://${host}${probe_path} is up"
}

# shellcheck source=scripts/ci/github-deployment-lib.sh
source scripts/ci/github-deployment-lib.sh
with_github_deployment "$deployment_env" "${target} ${mode} deploy to Vercel" "https://${host}" deploy
