#!/usr/bin/env bash
set -uo pipefail

real_gcloud="${GCLOUD_WIF_RETRY_REAL:-}"
max_attempts="${GCLOUD_WIF_RETRY_ATTEMPTS:-3}"
base_delay_seconds="${GCLOUD_WIF_RETRY_BASE_SECONDS:-10}"

if [ -z "$real_gcloud" ] || [ ! -x "$real_gcloud" ]; then
  echo "::error::GCLOUD_WIF_RETRY_REAL must point to the real gcloud executable." >&2
  exit 2
fi

# Keep the shim transparent for every gcloud operation except Cloud Run deploys.
if [ "${1:-}" != "run" ] || [ "${2:-}" != "deploy" ]; then
  exec "$real_gcloud" "$@"
fi

attempt=1
while [ "$attempt" -le "$max_attempts" ]; do
  output_file="$(mktemp)"
  trap 'rm -f "$output_file"' EXIT

  # Capture stderr synchronously so the retry check never inspects a partial
  # buffer, and leave stdout untouched for the deploy action's JSON parser.
  set +e
  "$real_gcloud" "$@" 2>"$output_file"
  exit_code="$?"
  set -e
  cat "$output_file" >&2

  if [ "$exit_code" -eq 0 ]; then
    exit 0
  fi

  if ! grep -Fq "Unable to retrieve Identity Pool subject token" "$output_file" ||
    ! grep -Fq "upstream request timeout" "$output_file"; then
    exit "$exit_code"
  fi

  if [ "$attempt" -eq "$max_attempts" ]; then
    echo "::error::gcloud run deploy exhausted $max_attempts attempts after transient WIF token timeouts." >&2
    exit "$exit_code"
  fi

  delay_seconds=$((base_delay_seconds * attempt))
  echo "::warning::gcloud run deploy hit a transient WIF token timeout; retrying in ${delay_seconds}s (attempt $((attempt + 1))/$max_attempts)." >&2
  sleep "$delay_seconds"
  attempt=$((attempt + 1))
done
