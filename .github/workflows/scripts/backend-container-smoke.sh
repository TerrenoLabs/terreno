#!/usr/bin/env bash
# Smoke-test a locally built backend image with production-like env and real
# Secret Manager values. Fails fast before Cloud Run push/deploy when startup
# or /health would not succeed. Never prints secret values.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: backend-container-smoke.sh

Required environment variables:
  SMOKE_IMAGE            Docker image tag to run (just built on this runner)
  GCP_PROJECT_ID         GCP project id
  GCP_BACKEND_SERVICE    Backend service name prefix for Secret Manager ids
  GITHUB_RUN_ID          GitHub Actions run id (container name scope)
  GITHUB_RUN_ATTEMPT     GitHub Actions run attempt (container name scope)

Optional:
  SMOKE_MODE             preview (default) | prod
  PR_NUMBER              Required when SMOKE_MODE=preview
  HEALTH_TIMEOUT_SEC     Seconds to wait for healthy /health (default: 240)
  HOST_PORT              Host port mapped to container :3000 (default: 13000)
EOF
}

log() {
  printf '%s\n' "$*"
}

fail() {
  printf '::error::%s\n' "$*" >&2
  exit 1
}

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    usage >&2
    fail "Missing required environment variable: $name"
  fi
}

require_env SMOKE_IMAGE
require_env GCP_PROJECT_ID
require_env GCP_BACKEND_SERVICE
require_env GITHUB_RUN_ID
require_env GITHUB_RUN_ATTEMPT

SMOKE_MODE="${SMOKE_MODE:-preview}"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-240}"
HOST_PORT="${HOST_PORT:-13000}"
CONTAINER_NAME="terreno-backend-smoke-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"

if [ "$SMOKE_MODE" = "preview" ] && [ -z "${PR_NUMBER:-}" ]; then
  fail "PR_NUMBER is required when SMOKE_MODE=preview"
fi

# Secret values collected only for log redaction; never printed.
declare -a REDACT_VALUES=()
TMP_FILES=()

cleanup() {
  local exit_code=$?
  if docker inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
  if [ ${#TMP_FILES[@]} -gt 0 ]; then
    rm -f "${TMP_FILES[@]}" 2>/dev/null || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

mktemp_secret_file() {
  local path
  path="$(mktemp)"
  chmod 600 "$path"
  TMP_FILES+=("$path")
  printf '%s' "$path"
}

fetch_secret() {
  local secret_id="$1"
  local dest_file="$2"
  if ! gcloud secrets versions access latest \
    --secret="$secret_id" \
    --project="$GCP_PROJECT_ID" \
    >"$dest_file" 2>/dev/null; then
    fail "Could not read Secret Manager secret: $secret_id"
  fi
  local value
  value="$(<"$dest_file")"
  if [ -n "$value" ]; then
    REDACT_VALUES+=("$value")
  fi
}

append_env_file_entry() {
  local env_file="$1"
  local key="$2"
  local value_file="$3"
  python3 - "$key" "$value_file" >>"$env_file" <<'PY'
import sys

key, path = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as handle:
    value = handle.read()
if "\n" in value or "\r" in value:
    raise SystemExit(f"{key} contains a newline, which Docker env files cannot represent safely")
sys.stdout.write(f"{key}={value}\n")
PY
}

append_env_literal() {
  local env_file="$1"
  local key="$2"
  local value="$3"
  python3 - "$key" "$value" >>"$env_file" <<'PY'
import sys

key, value = sys.argv[1], sys.argv[2]
if "\n" in value or "\r" in value:
    raise SystemExit(f"{key} contains a newline, which Docker env files cannot represent safely")
sys.stdout.write(f"{key}={value}\n")
PY
}

dump_safe_logs() {
  local raw filtered
  if ! raw="$(docker logs "$CONTAINER_NAME" 2>&1)"; then
    log "::warning::Could not read container logs for $CONTAINER_NAME"
    return
  fi
  filtered="$raw"
  for pattern in "${REDACT_VALUES[@]}"; do
    [ -n "$pattern" ] || continue
    filtered="$(FILTERED="$filtered" PATTERN="$pattern" python3 - <<'PY'
import os

text = os.environ["FILTERED"]
pattern = os.environ["PATTERN"]
print(text.replace(pattern, "[REDACTED]"))
PY
)"
  done
  filtered="$(FILTERED="$filtered" python3 - <<'PY'
import os
import re

text = os.environ["FILTERED"]
text = re.sub(r"mongodb(\+srv)?://\S+", "[REDACTED_MONGO_URI]", text)
text = re.sub(r"(?i)(better[_-]?auth[_-]?secret|password|token|api[_-]?key)\s*[=:]\s*\S+", r"\1=[REDACTED]", text)
print(text)
PY
)"
  log "--- container logs (secrets redacted) ---"
  # Cap output so CI stays readable; startup failures are usually near the tail.
  printf '%s\n' "$filtered" | tail -n 200
}

ENV_FILE="$(mktemp_secret_file)"

append_env_literal "$ENV_FILE" NODE_ENV production
append_env_literal "$ENV_FILE" PORT 3000
append_env_literal "$ENV_FILE" ADMIN_SPA_ENABLED true
append_env_literal "$ENV_FILE" CROSS_DOMAIN_AUTH_COOKIES true

if [ "$SMOKE_MODE" = "preview" ]; then
  append_env_literal "$ENV_FILE" CORS_ORIGINS "https://pr-${PR_NUMBER}--terreno-frontend.netlify.app"
  append_env_literal "$ENV_FILE" MONGO_DB_NAME "terreno-example-pr-${PR_NUMBER}"
  append_env_literal "$ENV_FILE" SEED_DEFAULTS true
  append_env_literal "$ENV_FILE" PR_NUMBER "$PR_NUMBER"
  BETTER_AUTH_URL="https://pr-${PR_NUMBER}---terreno-backend-example-7knxlrnpqq-uc.a.run.app"
else
  append_env_literal "$ENV_FILE" CORS_ORIGINS "https://terreno-frontend.netlify.app"
  BETTER_AUTH_URL="https://terreno-backend-example-7knxlrnpqq-uc.a.run.app"
fi

MONGO_URI_FILE="$(mktemp_secret_file)"
fetch_secret "${GCP_BACKEND_SERVICE}-mongodb-uri" "$MONGO_URI_FILE"
append_env_file_entry "$ENV_FILE" MONGO_URI "$MONGO_URI_FILE"

BETTER_AUTH_SECRET_ID="${GCP_BACKEND_SERVICE}-better-auth-secret"
if gcloud secrets versions access latest \
  --secret="$BETTER_AUTH_SECRET_ID" \
  --project="$GCP_PROJECT_ID" \
  >/dev/null 2>&1; then
  log "Better Auth secret found; enabling better-auth for smoke test."
  append_env_literal "$ENV_FILE" AUTH_PROVIDER better-auth
  append_env_literal "$ENV_FILE" BETTER_AUTH_URL "$BETTER_AUTH_URL"
  BETTER_AUTH_SECRET_FILE="$(mktemp_secret_file)"
  fetch_secret "$BETTER_AUTH_SECRET_ID" "$BETTER_AUTH_SECRET_FILE"
  append_env_file_entry "$ENV_FILE" BETTER_AUTH_SECRET "$BETTER_AUTH_SECRET_FILE"
else
  log "::warning::Better Auth secret '$BETTER_AUTH_SECRET_ID' not accessible; smoke test runs without better-auth."
fi

if [ "$SMOKE_MODE" = "preview" ]; then
  require_env GCP_TASKS_SERVICE
  require_env GCP_BACKEND_REGION
  require_env GCP_TASKS_QUEUE
  require_env GCP_TASKS_INVOKER_SA
  TASKS_URL="$(
    gcloud run services describe "$GCP_TASKS_SERVICE" \
      --region="$GCP_BACKEND_REGION" \
      --format='value(status.url)'
  )"
  append_env_literal "$ENV_FILE" JOBS_START_WORKER true
  append_env_literal "$ENV_FILE" JOBS_RUNNER gcp-cloud-tasks
  append_env_literal "$ENV_FILE" GCP_TASKS_PROJECT "$GCP_PROJECT_ID"
  append_env_literal "$ENV_FILE" GCP_TASKS_LOCATION "$GCP_BACKEND_REGION"
  append_env_literal "$ENV_FILE" GCP_TASKS_QUEUE "$GCP_TASKS_QUEUE"
  append_env_literal "$ENV_FILE" GCP_TASKS_PUBLIC_URL "https://pr-${PR_NUMBER}---${TASKS_URL#https://}"
  append_env_literal "$ENV_FILE" GCP_TASKS_OIDC_AUDIENCE "$TASKS_URL"
  append_env_literal "$ENV_FILE" GCP_TASKS_SERVICE_ACCOUNT_EMAIL "$GCP_TASKS_INVOKER_SA"
fi

log "Starting smoke-test container name=$CONTAINER_NAME image=$SMOKE_IMAGE host_port=$HOST_PORT timeout=${HEALTH_TIMEOUT_SEC}s"

docker run -d \
  --name "$CONTAINER_NAME" \
  --env-file "$ENV_FILE" \
  -p "${HOST_PORT}:3000" \
  "$SMOKE_IMAGE" \
  >/dev/null

deadline=$((SECONDS + HEALTH_TIMEOUT_SEC))
started_at=$SECONDS
while [ "$SECONDS" -lt "$deadline" ]; do
  # Probe from inside the container: CircleCI remote Docker does not expose
  # published ports on the job host, so 127.0.0.1:${HOST_PORT} is unreachable.
  if docker exec "$CONTAINER_NAME" curl -fsS "http://127.0.0.1:3000/health" 2>/dev/null | grep -q '"healthy":true'; then
    log "Container passed /health after $((SECONDS - started_at))s."
    exit 0
  fi
  if ! docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null | grep -qx true; then
    log "::error::Container exited before /health became healthy."
    dump_safe_logs
    exit 1
  fi
  sleep 2
done

log "::error::Container did not pass /health within ${HEALTH_TIMEOUT_SEC}s (matches Cloud Run startup probe budget)."
dump_safe_logs
exit 1
