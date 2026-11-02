#!/usr/bin/env bash
# Generates an app with `terreno bootstrap app --terreno-path` from this checkout, then
# type-checks its backend and exports its frontend. A package added to the bootstrap
# closure without its build output in `files` fails here. Expects `bun install` to have run.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

# Packs keep the same file name between runs, so a shared install cache can serve stale contents.
export BUN_INSTALL_CACHE_DIR="$work_dir/bun-cache"

cd "$repo_root"
bun run compile

app_dir="$work_dir/app"
bun cli/dist/bin.js bootstrap app --name bootstrap-check --display-name "Bootstrap Check" \
  --dir "$app_dir" --terreno-path "$repo_root"

# Type-checking only reaches packages the app imports, so check transitive packs directly.
for pack in "$app_dir"/vendor/terreno/*.tgz; do
  if ! tar tzf "$pack" | grep -q "^package/dist/"; then
    echo "$(basename "$pack") has no dist. Add dist to the files list in its package.json." >&2
    exit 1
  fi
done

cd "$app_dir/backend"
bun install
bun x tsc --noEmit

cd "$app_dir/frontend"
bun install
bun x expo export --platform web --output-dir "$work_dir/web"
test -f "$work_dir/web/index.html"
