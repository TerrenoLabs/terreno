#!/usr/bin/env bash
# Cloud Agent install script for the Terreno monorepo.
# Idempotent: prepares Bun, workspace dependencies, compiled packages, and a
# standalone mongod binary (a real replica-set MongoDB is required at runtime for
# change streams that power realtime/feature-flag/syncdb sync).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# 1. Ensure Bun is installed (Cursor's default base image does not ship it).
if [ ! -x "$HOME/.bun/bin/bun" ]; then
  curl -fsSL https://bun.sh/install | bash
fi
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$HOME/.bun/bin:$PATH"
bun --version

# 2. Install workspace dependencies and compile every package (dev-ready setup).
bun install
bun run compile

# 2b. Install the git pre-commit hook and make `bun` resolvable from it. Git runs
#     hooks with the agent's PATH, which often lacks ~/.bun/bin; a missing `bun`
#     fails every commit and pushes agents toward --no-verify, which skips the
#     Biome check and produces follow-up "fix formatting" commits.
if sudo -n true 2>/dev/null; then
  sudo ln -sf "$HOME/.bun/bin/bun" /usr/local/bin/bun
  sudo ln -sf "$HOME/.bun/bin/bunx" /usr/local/bin/bunx
fi
bunx simple-git-hooks
if [ ! -x "$(git rev-parse --git-path hooks/pre-commit)" ]; then
  echo "ERROR: pre-commit hook was not installed" >&2
  exit 1
fi
if ! env -i PATH=/usr/local/bin:/usr/bin:/bin sh -c 'command -v bun' >/dev/null; then
  echo "WARNING: bun is not on the default PATH, so git hooks cannot run it." >&2
  echo "WARNING: add $HOME/.bun/bin to PATH for the agent process or grant sudo." >&2
fi

# 3. Cache a standalone mongod binary at a stable path. mongodb-memory-server
#    downloads the exact pinned version the test suites use; MongoBinary.getPath
#    returns the real executable path (downloading it if needed) regardless of the
#    library's internal cache layout.
MONGOD_DIR="$HOME/.local/mongod-bin"
MONGOD_BIN="$MONGOD_DIR/mongod"
mkdir -p "$MONGOD_DIR"
if [ ! -x "$MONGOD_BIN" ]; then
  RESOLVED="$(node -e 'import("mongodb-memory-server-core").then(async (m)=>{const p=await m.MongoBinary.getPath({});process.stdout.write(p);}).catch((e)=>{console.error(e);process.exit(1);})')"
  if [ -z "$RESOLVED" ] || [ ! -x "$RESOLVED" ]; then
    echo "ERROR: could not resolve a mongod binary via mongodb-memory-server" >&2
    exit 1
  fi
  cp "$RESOLVED" "$MONGOD_BIN"
  chmod +x "$MONGOD_BIN"
fi
"$MONGOD_BIN" --version | head -1

# 4. Ensure the local replica-set data directory exists.
mkdir -p "$HOME/.local/mongo-data"

# 5. Install the Chromium browser (+ system deps) used for frontend UI
#    verification, and expose it at a stable, version-independent path.
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
if sudo -n true 2>/dev/null; then
  bunx playwright install --with-deps chromium
else
  bunx playwright install chromium
fi
CHROME_BIN="$(node -e 'const {chromium}=require("'"$REPO_ROOT"'/node_modules/playwright/index.js"); process.stdout.write(chromium.executablePath());')"
if [ -n "$CHROME_BIN" ] && [ -x "$CHROME_BIN" ]; then
  mkdir -p "$HOME/.local/chrome-bin"
  ln -sf "$CHROME_BIN" "$HOME/.local/chrome-bin/chrome"
  "$HOME/.local/chrome-bin/chrome" --headless --no-sandbox --version | head -1
else
  echo "WARNING: could not resolve a Chromium executable path" >&2
fi

echo "install.sh complete"
