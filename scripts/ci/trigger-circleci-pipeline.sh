#!/usr/bin/env bash
# Start a CircleCI pipeline on master with setup-pipeline parameters.
# Used by GitHub-only events (pull_request.closed, manual GHA publish) that
# CircleCI never receives.
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 '<parameters JSON object>'" >&2
  exit 2
fi

parameters="$1"
project_slug="${CIRCLECI_PROJECT_SLUG:-circleci/6UHiK7pThPXbhnNi3umQNe/LdjghuhydHjFMyFjcEXMA2}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"${SCRIPT_DIR}/validate-env.sh" CIRCLECI_TOKEN CIRCLECI_PIPELINE_DEFINITION_ID

if ! echo "$parameters" | jq -e 'type == "object"' >/dev/null; then
  echo "Parameters must be a JSON object: $parameters" >&2
  exit 2
fi

body="$(jq -n \
  --arg definition "$CIRCLECI_PIPELINE_DEFINITION_ID" \
  --argjson parameters "$parameters" \
  '{definition_id: $definition, config: {branch: "master"}, checkout: {branch: "master"}, parameters: $parameters}')"

curl --fail-with-body --silent --show-error \
  -X POST \
  -H "Circle-Token: ${CIRCLECI_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "$body" \
  "https://circleci.com/api/v2/project/${project_slug}/pipeline/run"
echo
