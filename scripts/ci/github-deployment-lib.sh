#!/usr/bin/env bash
# Sourced by deploy scripts. Wraps one deploy command in a GitHub Deployment
# record: in_progress before, success/failure after, with the environment URL.

github_deployment_script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/github-deployment.sh"

# Usage: with_github_deployment <environment> <description> <environment-url> <command...>
# Returns the command's exit status; the record itself never fails the deploy.
with_github_deployment() {
  local environment="$1"
  local description="$2"
  local environment_url="$3"
  shift 3

  local deployment_id
  deployment_id="$("$github_deployment_script" start "$environment" "$description")"

  local status
  set +e
  # Subshell so errexit still applies inside the wrapped command or function.
  (
    set -e
    "$@"
  )
  status=$?
  set -e

  local state=success
  if [ "$status" -ne 0 ]; then
    state=failure
  fi
  "$github_deployment_script" finish "$deployment_id" "$state" "$environment_url"
  return "$status"
}
