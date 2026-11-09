#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <package-directory> <version> [npm-tag] [release|manual]" >&2
  exit 2
fi

package_directory="$1"
version="$2"
npm_tag="${3:-latest}"
dependency_mode="${4:-release}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

scripts/ci/validate-env.sh NPM_TOKEN
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]]; then
  echo "Invalid package version: $version" >&2
  exit 2
fi

package_name="$(node -e "process.stdout.write(require('./${package_directory}/package.json').name)")"
# Retries of the same tag must not fail on packages that already landed.
if npm view "${package_name}@${version}" version >/dev/null 2>&1; then
  echo "Already on npm: ${package_name}@${version}; skipping"
  exit 0
fi

bun run scripts/ci/prepare-package-publish.mjs "$package_directory" "$version" "$dependency_mode"
# Pinning workspace:* to this version must not reinstall from the registry.
# Sibling @terreno packages are unpublished at this tag, so a second install
# would resolve @terreno/test@X.Y.Z / @terreno/syncdb@X.Y.Z from npm and fail.
# Compile and test use the root workspace install from install_bun_and_deps.
#
# TERRENO_PUBLISH_PREBUILT=1: the caller already compiled every package once
# and the tagged commit already passed CI on master, so skip compile and tests.
# publish-release sets this; recompiling each package's dependency tree and
# rerunning every suite per package made releases take 20+ minutes.
if [ "${TERRENO_PUBLISH_PREBUILT:-}" != "1" ]; then
  node .github/scripts/compile-workspace-deps.js "$package_directory"

  if bun -e "
    const pkg = await Bun.file('$package_directory/package.json').json();
    process.exit(pkg.scripts?.compile ? 0 : 1);
  "; then
    (cd "$package_directory" && bun run compile)
  fi

  # Prefer test:ci. Several packages (notably @terreno/ui) define test as
  # `bun test --watch`, which finishes the suite then waits forever with no
  # output. CircleCI then kills the publish step (default 10m no_output_timeout).
  # api's test script also updates snapshots; test:ci is the non-mutating path.
  if bun -e "
    const pkg = await Bun.file('$package_directory/package.json').json();
    process.exit(pkg.scripts?.['test:ci'] ? 0 : 1);
  "; then
    (cd "$package_directory" && bun run test:ci)
  elif bun -e "
    const pkg = await Bun.file('$package_directory/package.json').json();
    process.exit(pkg.scripts?.test ? 0 : 1);
  "; then
    (cd "$package_directory" && bun run test)
  fi
fi

# Per-invocation npmrc so parallel publishes cannot delete each other's token.
npmrc="$(mktemp)"
trap 'rm -f "$npmrc"' EXIT
printf '//registry.npmjs.org/:_authToken=%s\n' "$NPM_TOKEN" > "$npmrc"
(cd "$package_directory" && NPM_CONFIG_USERCONFIG="$npmrc" npm publish --tag "$npm_tag")
