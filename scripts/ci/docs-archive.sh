#!/usr/bin/env bash
# Prebuilt sites for released docs versions.
#
# Each released version is built once, at release time, from its
# website/versioned_docs snapshot with baseUrl /<version>/, and stored as the
# docs-site.tar.gz asset on that version's GitHub release. Production deploys
# download those archives into the publish dir instead of rebuilding every
# version, so a docs build only ever bundles one docs tree.
#
#   docs-archive.sh build <version> <out.tar.gz>   build one version's site
#   docs-archive.sh upload <version> <file.tar.gz> attach it to the GitHub release (GITHUB_TOKEN)
#   docs-archive.sh fetch <publish-dir>            unpack every version in versions.json
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
repo="TerrenoLabs/terreno"
asset_name="docs-site.tar.gz"

usage() {
  echo "Usage: $0 build <version> <out.tar.gz> | upload <version> <file.tar.gz> | fetch <publish-dir>" >&2
  exit 2
}

build_archive() {
  local version="$1" out="$2"
  local snapshot="$repo_root/website/versioned_docs/version-${version}"
  if [ ! -d "$snapshot" ]; then
    echo "No docs snapshot at $snapshot; run 'bun run docs:version ${version}' in website/ first." >&2
    exit 1
  fi
  local out_dir
  out_dir="$(mktemp -d)"
  (
    cd "$repo_root/website"
    # Docusaurus sizes its SSG worker pool from the CPU count, which can report the
    # host's cores inside CI containers. Each worker loads the full server bundle.
    DOCUSAURUS_SSG_WORKER_THREAD_COUNT=1 \
      DOCS_ARCHIVE_VERSION="$version" \
      DEMO_URL=https://terreno-demo.netlify.app \
      bunx docusaurus build --no-minify --out-dir "$out_dir"
  )
  mkdir -p "$(dirname "$out")"
  tar -czf "$out" -C "$out_dir" .
  rm -rf "$out_dir"
  echo "Built docs ${version} -> ${out} ($(du -h "$out" | cut -f1))"
}

github_api() {
  curl --fail --silent --show-error \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    "$@"
}

upload_archive() {
  local version="$1" file="$2"
  "$repo_root/scripts/ci/validate-env.sh" GITHUB_TOKEN
  local release
  release="$(github_api "https://api.github.com/repos/${repo}/releases/tags/${version}")"
  local release_id
  release_id="$(jq -r '.id' <<<"$release")"
  # Re-runs replace the asset instead of failing on a duplicate name.
  local existing_id
  existing_id="$(jq -r --arg name "$asset_name" '.assets[] | select(.name == $name) | .id' <<<"$release")"
  if [ -n "$existing_id" ]; then
    github_api -X DELETE "https://api.github.com/repos/${repo}/releases/assets/${existing_id}"
  fi
  github_api -X POST \
    -H "Content-Type: application/gzip" \
    --data-binary "@${file}" \
    "https://uploads.github.com/repos/${repo}/releases/${release_id}/assets?name=${asset_name}" >/dev/null
  echo "Uploaded ${asset_name} to release ${version}"
}

fetch_archives() {
  local publish_dir="$1"
  local versions
  versions="$(jq -r '.[]' "$repo_root/website/versions.json")"
  local version
  for version in $versions; do
    local tmp
    tmp="$(mktemp)"
    # Public release assets download without a token.
    if ! curl --fail --silent --show-error --location --retry 3 \
      -o "$tmp" "https://github.com/${repo}/releases/download/${version}/${asset_name}"; then
      # A missing archive should not block shipping the current docs; the version
      # dropdown link 404s until 'docs-archive.sh build/upload' runs for it.
      echo "WARNING: no ${asset_name} on release ${version}; /${version}/ will 404." >&2
      rm -f "$tmp"
      continue
    fi
    rm -rf "${publish_dir:?}/${version}"
    mkdir -p "${publish_dir}/${version}"
    tar -xzf "$tmp" -C "${publish_dir}/${version}"
    rm -f "$tmp"
    echo "Unpacked docs ${version} into ${publish_dir}/${version}"
  done
}

[ "$#" -ge 1 ] || usage
command="$1"
shift
case "$command" in
  build)
    [ "$#" -eq 2 ] || usage
    build_archive "$1" "$2"
    ;;
  upload)
    [ "$#" -eq 2 ] || usage
    upload_archive "$1" "$2"
    ;;
  fetch)
    [ "$#" -eq 1 ] || usage
    fetch_archives "$1"
    ;;
  *)
    usage
    ;;
esac
