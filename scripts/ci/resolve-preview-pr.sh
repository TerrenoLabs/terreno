#!/usr/bin/env bash
# Resolve a GitHub PR number for CircleCI preview deploys.
# Prints one of: a numeric PR id, "skip-fork", or "skip-missing".
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Deployment tokens are scoped to TerrenoLabs/terreno. CIRCLE_PROJECT_USERNAME
# can still be the pre-transfer FlourishHealth CircleCI project link.
repository="${GITHUB_REPOSITORY:-TerrenoLabs/terreno}"
owner="${repository%%/*}"
repo="${repository#*/}"

# CircleCI sets CIRCLE_PR_* only for forked pull requests (legacy GitHub OAuth).
if [ -n "${CIRCLE_PR_REPONAME:-}" ] || [ -n "${CIRCLE_PR_USERNAME:-}" ]; then
  echo "skip-fork"
  exit 0
fi

number=""
if [[ "${CIRCLE_PULL_REQUEST:-}" =~ /pull/([0-9]+) ]]; then
  number="${BASH_REMATCH[1]}"
elif [[ "${CIRCLE_PR_NUMBER:-}" =~ ^[0-9]+$ ]]; then
  number="${CIRCLE_PR_NUMBER}"
fi

if [[ "$number" =~ ^[0-9]+$ ]]; then
  # GitHub App pipelines leave CIRCLE_PR_* unset. Ask the pulls API before deploying.
  if [ "$("$script_dir/pull-request-fork.sh" "$number")" = "fork" ]; then
    echo "skip-fork"
    exit 0
  fi
  echo "$number"
  exit 0
fi

branch="${CIRCLE_BRANCH:-}"
if [ -n "$owner" ] && [ -n "$repo" ] && [ -n "$branch" ]; then
  api_base="${GITHUB_API_URL:-https://api.github.com}"
  encoded="$(node -e "process.stdout.write(encodeURIComponent(process.env.CIRCLE_BRANCH ?? \"\"))")"
  url="${api_base}/repos/${owner}/${repo}/pulls?head=${owner}:${encoded}&state=open"
  # Deploy jobs carry the terreno-github-deployments token; authenticate to avoid rate limits.
  lookup_token="${GITHUB_TOKEN:-${GITHUB_DEPLOYMENTS_TOKEN:-}}"
  auth_args=()
  if [ -n "$lookup_token" ]; then
    auth_args=(-H "Authorization: Bearer ${lookup_token}")
  fi
  # ${arr[@]+...} keeps bash 3.2 (macOS) from treating an empty array as unset under set -u.
  body="$(curl -fsS --max-time 10 ${auth_args[@]+"${auth_args[@]}"} -H "Accept: application/vnd.github+json" "$url" || true)"
  number="$(node -e '
const fs = require("fs");
const raw = fs.readFileSync(0, "utf8").trim();
if (!raw) process.exit(0);
let data;
try { data = JSON.parse(raw); } catch { process.exit(0); }
if (Array.isArray(data) && data[0] && data[0].number) {
  process.stdout.write(String(data[0].number));
}
' <<<"$body")"
  if [[ "$number" =~ ^[0-9]+$ ]]; then
    echo "$number"
    exit 0
  fi
fi

echo "skip-missing"
