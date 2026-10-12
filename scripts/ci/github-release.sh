#!/usr/bin/env bash
# GitHub release helpers for the tag pipeline.
#
# Releases are created as drafts (release skill: push the tag, then
# `gh release create --draft`). This repo has immutable releases on: once a
# release is published its assets are locked, so CI attaches the docs archive
# to the draft first and publishes it last.
#
#   github-release.sh id <version>       print the release id (waits for the draft)
#   github-release.sh publish <version>  publish the draft; no-op when already published
#
# Needs GITHUB_TOKEN with contents:write. RELEASE_WAIT_SECONDS (default 600)
# bounds the wait for the draft to appear after the tag push.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
repo="TerrenoLabs/terreno"
wait_seconds="${RELEASE_WAIT_SECONDS:-600}"
poll_seconds=15

usage() {
  echo "Usage: $0 id <version> | publish <version>" >&2
  exit 2
}

github_api() {
  curl --fail --silent --show-error \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    "$@"
}

# GET /releases/tags/{tag} never returns drafts, so search the release list.
find_release_json() {
  local version="$1"
  github_api "https://api.github.com/repos/${repo}/releases?per_page=100" |
    jq -c --arg tag "$version" 'first(.[] | select(.tag_name == $tag)) // empty'
}

# Prints the release JSON, polling until it exists. Fails after wait_seconds.
wait_for_release_json() {
  local version="$1"
  "$repo_root/scripts/ci/validate-env.sh" GITHUB_TOKEN
  local waited=0 release
  while :; do
    release="$(find_release_json "$version")"
    if [ -n "$release" ]; then
      echo "$release"
      return 0
    fi
    if [ "$waited" -ge "$wait_seconds" ]; then
      echo "No GitHub release (draft or published) for tag ${version} after ${wait_seconds}s." >&2
      echo "Create it with: gh release create ${version} --draft --verify-tag --title ${version} --notes-file <notes>" >&2
      exit 1
    fi
    echo "Waiting for the GitHub release for ${version} (${waited}s)..." >&2
    sleep "$poll_seconds"
    waited=$((waited + poll_seconds))
  done
}

release_id() {
  local version="$1"
  wait_for_release_json "$version" | jq -r '.id'
}

publish_release() {
  local version="$1"
  local release
  release="$(wait_for_release_json "$version")"
  if [ "$(jq -r '.draft' <<<"$release")" != "true" ]; then
    echo "Release ${version} is already published; nothing to do."
    return 0
  fi
  local body
  if [[ "$version" == *-* ]]; then
    body='{"draft":false,"prerelease":true,"make_latest":"false"}'
  else
    # Matches what `gh release create` did before releases became drafts.
    body='{"draft":false,"make_latest":"true"}'
  fi
  github_api -X PATCH \
    -H "Content-Type: application/json" \
    --data "$body" \
    "https://api.github.com/repos/${repo}/releases/$(jq -r '.id' <<<"$release")" >/dev/null
  echo "Published GitHub release ${version}"
}

[ "$#" -eq 2 ] || usage
case "$1" in
  id)
    release_id "$2"
    ;;
  publish)
    publish_release "$2"
    ;;
  *)
    usage
    ;;
esac
