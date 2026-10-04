#!/usr/bin/env bash

set -uo pipefail

hook_host="${1:-}"
hook_input="$(cat)"
repository_root="$(git rev-parse --show-toplevel)"
cd "$repository_root"

if ! command -v bun >/dev/null 2>&1 && [[ -x "${HOME}/.bun/bin/bun" ]]; then
  export PATH="${HOME}/.bun/bin:${PATH}"
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "Quality checks failed: bun not found on PATH (install: https://bun.sh)" >&2
  if [[ "$hook_host" == "cursor" ]]; then
    printf '{"followup_message":"Quality checks failed because bun is not installed or not on PATH. Run bun bootstrap from the repo root, then retry."}\n'
    exit 0
  fi
  printf '{"decision":"block","reason":"Quality checks failed because bun is not installed or not on PATH."}\n'
  exit 0
fi

if [[ "$hook_host" != "cursor" ]] && grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true' <<<"$hook_input"; then
  printf '{}\n'
  exit 0
fi

lint_status=0
typecheck_status=0
analysis_status=0

# Cloud agents may run this hook before workspace install finishes; typecheck needs linked @terreno/* packages.
if [[ ! -f node_modules/typescript/package.json ]]; then
  echo "Quality checks: installing workspace dependencies..." >&2
  bun install --frozen-lockfile >&2 || {
    echo "Quality checks failed: bun install --frozen-lockfile" >&2
    if [[ "$hook_host" == "cursor" ]]; then
      printf '{"followup_message":"Quality checks failed because workspace dependencies are not installed. Run bun install --frozen-lockfile from the repo root, then retry."}\n'
      exit 0
    fi
    printf '{"decision":"block","reason":"Quality checks failed because workspace dependencies are not installed."}\n'
    exit 0
  }
fi

bun run lint >&2 || lint_status=$?
bun run compile >&2 || typecheck_status=$?
bun run analyze:full >&2 || analysis_status=$?

if ((lint_status == 0 && typecheck_status == 0 && analysis_status == 0)); then
  printf '{}\n'
  exit 0
fi

echo "Quality checks failed: lint=$lint_status typecheck=$typecheck_status analysis=$analysis_status" >&2
if [[ "$hook_host" == "cursor" ]]; then
  printf '{"followup_message":"Quality checks failed (lint=%d, typecheck=%d, analysis=%d). Fix the reported errors before stopping."}\n' \
    "$lint_status" "$typecheck_status" "$analysis_status"
  exit 0
fi

printf '{"decision":"block","reason":"Quality checks failed (lint=%d, typecheck=%d, analysis=%d). Fix the reported errors before stopping."}\n' \
  "$lint_status" "$typecheck_status" "$analysis_status"
