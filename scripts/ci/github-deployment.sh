#!/usr/bin/env bash
# Record a CircleCI deploy as a GitHub Deployment so PRs and the repository
# Environments page show what is live. Best-effort: a missing token or GitHub
# API error prints a warning and exits 0, so it never fails a deploy.
#
# Usage:
#   github-deployment.sh start <environment> <description>
#     Creates the deployment, marks it in_progress, prints its id (empty on skip).
#   github-deployment.sh finish <deployment-id> <success|failure> [environment-url]
set -uo pipefail

api_base="${GITHUB_API_URL:-https://api.github.com}"
# CircleCI does not set GITHUB_REPOSITORY. Do not fall back to
# CIRCLE_PROJECT_USERNAME: that project can still be the pre-transfer
# FlourishHealth link, while deployment records belong on TerrenoLabs/terreno.
repository="${GITHUB_REPOSITORY:-TerrenoLabs/terreno}"
token="${GITHUB_DEPLOYMENTS_TOKEN:-}"

warn() {
  echo "warning: GitHub Deployment record: $*" >&2
}

github_post() {
  local path="$1"
  local body="$2"
  curl --silent --show-error --max-time 20 \
    -X POST \
    -H "Authorization: Bearer ${token}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    --data "$body" \
    "${api_base}/repos/${repository}/${path}"
}

post_status() {
  local deployment_id="$1"
  local state="$2"
  local environment_url="${3:-}"
  local body
  body="$(jq -n \
    --arg state "$state" \
    --arg log_url "${CIRCLE_BUILD_URL:-}" \
    --arg environment_url "$environment_url" \
    '{state: $state, auto_inactive: true}
      + (if $log_url == "" then {} else {log_url: $log_url} end)
      + (if $environment_url == "" then {} else {environment_url: $environment_url} end)')"
  local response
  if ! response="$(github_post "deployments/${deployment_id}/statuses" "$body")"; then
    warn "could not set deployment ${deployment_id} to ${state}"
    return 0
  fi
  if [ -z "$(jq -r '.id // empty' <<<"$response" 2>/dev/null)" ]; then
    warn "GitHub rejected status ${state} for deployment ${deployment_id}: $(jq -r '.message // .' <<<"$response" 2>/dev/null)"
  fi
}

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 start <environment> <description> | finish <deployment-id> <success|failure> [environment-url]" >&2
  exit 2
fi

command="$1"
shift

if [ -z "$token" ]; then
  warn "GITHUB_DEPLOYMENTS_TOKEN is unset (terreno-github-deployments context); skipping"
  exit 0
fi

case "$command" in
  start)
    environment="$1"
    description="$2"
    ref="${CIRCLE_SHA1:-}"
    if [ -z "$ref" ]; then
      warn "CIRCLE_SHA1 is unset; skipping ${environment}"
      exit 0
    fi
    transient=false
    production=true
    if [[ "$environment" == *-preview-pr-* ]]; then
      transient=true
      production=false
    fi
    body="$(jq -n \
      --arg ref "$ref" \
      --arg environment "$environment" \
      --arg description "$description" \
      --argjson transient "$transient" \
      --argjson production "$production" \
      '{ref: $ref, environment: $environment, description: $description,
        auto_merge: false, required_contexts: [],
        transient_environment: $transient, production_environment: $production}')"
    if ! response="$(github_post deployments "$body")"; then
      warn "could not create deployment for ${environment}"
      exit 0
    fi
    deployment_id="$(jq -r '.id // empty' <<<"$response" 2>/dev/null)"
    if [ -z "$deployment_id" ]; then
      warn "GitHub rejected deployment for ${environment}: $(jq -r '.message // .' <<<"$response" 2>/dev/null)"
      exit 0
    fi
    post_status "$deployment_id" in_progress
    echo "$deployment_id"
    ;;
  finish)
    deployment_id="$1"
    state="$2"
    environment_url="${3:-}"
    if [ -z "$deployment_id" ]; then
      exit 0
    fi
    if [ "$state" != "success" ] && [ "$state" != "failure" ]; then
      echo "finish state must be success or failure, got: $state" >&2
      exit 2
    fi
    post_status "$deployment_id" "$state" "$environment_url"
    ;;
  *)
    echo "Unknown command: $command" >&2
    exit 2
    ;;
esac
