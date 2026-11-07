#!/usr/bin/env bash
# Smoke-check a running example-backend image's server-rendered admin SPA.
#
# Usage: ADMIN_SPA_SMOKE_BRAND="<brand name>" scripts/admin-spa-image-smoke.sh <base-url>
#
# Passes (exit 0) only when:
#   - GET <base>/console/login is 200 HTML containing the brand and the login form;
#   - GET <base>/_expo/loaders/login is 200 JSON sent with `Cache-Control: no-store, private`.
set -euo pipefail

base_url="${1:-}"

missing=()
if [ -z "$base_url" ]; then missing+=("<base-url> argument"); fi
if [ -z "${ADMIN_SPA_SMOKE_BRAND:-}" ]; then missing+=("ADMIN_SPA_SMOKE_BRAND"); fi
if [ ${#missing[@]} -ne 0 ]; then
  echo "Missing required input: ${missing[*]}" >&2
  echo "Usage: ADMIN_SPA_SMOKE_BRAND=\"<brand>\" $0 <base-url>" >&2
  exit 1
fi

base_url="${base_url%/}"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

fail() {
  echo "admin-spa image smoke FAILED: $1" >&2
  exit 1
}

# fetch <path> <name>: writes <name>.body and <name>.headers, prints the status code.
fetch() {
  # curl prints 000 itself when it cannot connect; a non-zero exit must not end the script.
  curl -sS -o "$work_dir/$2.body" -D "$work_dir/$2.headers" -w "%{http_code}" "$base_url$1" || true
}

header_value() {
  grep -i "^$2:" "$work_dir/$1.headers" | tail -1 | cut -d: -f2- | tr -d '\r' | sed 's/^ *//'
}

login_status="$(fetch /console/login login)"
if [ "$login_status" != "200" ]; then
  fail "login page: GET /console/login answered $login_status, expected 200"
fi
if ! header_value login content-type | grep -qi "text/html"; then
  fail "login page: content type is '$(header_value login content-type)', expected text/html"
fi
if ! grep -qF "$ADMIN_SPA_SMOKE_BRAND" "$work_dir/login.body"; then
  fail "login page: the server-rendered HTML does not contain the brand '$ADMIN_SPA_SMOKE_BRAND'"
fi
if ! grep -qF "admin-spa-login-email" "$work_dir/login.body"; then
  fail "login page: the server-rendered HTML does not contain the login form (admin-spa-login-email)"
fi

loader_status="$(fetch /_expo/loaders/login loader)"
if [ "$loader_status" != "200" ]; then
  fail "login loader: GET /_expo/loaders/login answered $loader_status, expected 200"
fi
if ! header_value loader content-type | grep -qi "application/json"; then
  fail "login loader: content type is '$(header_value loader content-type)', expected application/json"
fi
cache_control="$(header_value loader cache-control)"
if [ "$(echo "$cache_control" | tr -d ' ' | tr '[:upper:]' '[:lower:]')" != "no-store,private" ]; then
  fail "login loader: Cache-Control is '$cache_control', expected 'no-store, private'"
fi

echo "admin-spa image smoke passed: /console/login is server-rendered and /_expo/loaders/login is no-store, private"
