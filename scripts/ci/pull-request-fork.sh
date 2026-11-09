#!/usr/bin/env bash
# Print fork, same, or unknown for a GitHub pull request number.
# GitHub App CircleCI builds do not set CIRCLE_PR_USERNAME or CIRCLE_PR_REPONAME.
# Keep the classifier in sync with skip_if_fork_deploy in .circleci/continue-config.yml.
set -euo pipefail

number="${1:-}"
if ! [[ "$number" =~ ^[0-9]+$ ]]; then
  echo "unknown"
  exit 0
fi

repository="${GITHUB_REPOSITORY:-TerrenoLabs/terreno}"
api_base="${GITHUB_API_URL:-https://api.github.com}"
lookup_token="${GITHUB_TOKEN:-${GITHUB_DEPLOYMENTS_TOKEN:-}}"
auth_args=()
if [ -n "$lookup_token" ]; then
  auth_args=(-H "Authorization: Bearer ${lookup_token}")
fi
# ${arr[@]+...} keeps bash 3.2 (macOS) from treating an empty array as unset under set -u.
body="$(curl -fsS --max-time 10 ${auth_args[@]+"${auth_args[@]}"} \
  -H "Accept: application/vnd.github+json" \
  "${api_base}/repos/${repository}/pulls/${number}" || true)"

node -e '
const fs = require("fs");
const raw = fs.readFileSync(0, "utf8").trim();
const write = (value) => process.stdout.write(value);
if (!raw) { write("unknown"); process.exit(0); }
let data;
try { data = JSON.parse(raw); } catch { write("unknown"); process.exit(0); }
const head = data && data.head && data.head.repo && data.head.repo.full_name;
const base = data && data.base && data.base.repo && data.base.repo.full_name;
if (!head || !base) { write("unknown"); process.exit(0); }
write(head === base ? "same" : "fork");
' <<<"$body"
