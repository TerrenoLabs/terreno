#!/usr/bin/env bash

set -euo pipefail
shopt -s nullglob

mode="${1:-full}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

run_test_file() {
  local file="$1"
  local -a args=(--max-concurrency=1)
  if [[ "$mode" == "agent" ]]; then
    args=(--only-failures)
  fi

  if [[ "$file" == "./src/isolated/hooks.isolated.tsx" || "$file" == "./src/isolated/adminModelTable.ssr.isolated.tsx" || "$file" == "./src/isolated/adminModelForm.ssr.isolated.tsx" || "$file" == "./src/isolated/adminModelTable.windowedSeed.isolated.tsx" ]]; then
    ADMIN_USE_REAL_API=1 AGENT="${AGENT:-}" bun test "${args[@]}" "$file"
    return
  fi

  AGENT="${AGENT:-}" bun test "${args[@]}" "$file"
}

if [[ "$mode" == "full" ]]; then
  bun test --max-concurrency=1
  files=(
    ./src/*.isolated.tsx
    ./src/*.isolated.ts
    ./src/isolated/*.isolated.tsx
    ./src/isolated/*.isolated.ts
  )
else
  files=(
    ./src/*.test.ts
    ./src/*.test.tsx
    ./src/**/*.test.ts
    ./src/**/*.test.tsx
    ./src/isolated/*.isolated.tsx
    ./src/isolated/*.isolated.ts
  )
fi

for file in "${files[@]}"; do
  run_test_file "$file"
done
