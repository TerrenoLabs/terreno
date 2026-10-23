#!/usr/bin/env bash
# Web and auth settings for one example-backend Cloud Run deploy.
#
#   backend-auth-env.sh env <prod|pr-N>       KEY=VALUE lines: CORS_ORIGINS, FRONTEND_URL,
#                                             BETTER_AUTH_URL, OAUTH_PROXY_PRODUCTION_URL and, on
#                                             a stable deploy that shares a domain, PASSKEY_RP_ID.
#   backend-auth-env.sh gcloud-env <tag> <base>
#                                             One --set-env-vars value: <base> (comma-separated,
#                                             no commas inside values) plus the `env` lines, with
#                                             ";" as gcloud's delimiter, since CORS_ORIGINS can
#                                             hold a comma.
#   backend-auth-env.sh secrets <prod|pr-N>   ENV=secret:latest lines for the OAuth provider
#                                             secrets that have a version (H1 adds them). Previews
#                                             get only the client IDs: stable exchanges every code.
#
# The stable deploy owns the registered OAuth callbacks; previews reach providers through it
# (Better Auth oauth-proxy). STABLE_BACKEND_URL and STABLE_FRONTEND_URL default to today's
# run.app and netlify.app hosts, so moving stable onto one domain is a two-variable change.
# STABLE_PASSKEY_RP_ID overrides the stable passkey rpID the script would derive.
set -euo pipefail

cloud_run_backend_url="${CLOUD_RUN_BACKEND_URL:-https://terreno-backend-example-7knxlrnpqq-uc.a.run.app}"
legacy_frontend_url="https://terreno-frontend.netlify.app"
netlify_site_host="terreno-frontend.netlify.app"
stable_backend_url="${STABLE_BACKEND_URL:-$cloud_run_backend_url}"
stable_frontend_url="${STABLE_FRONTEND_URL:-$legacy_frontend_url}"

# Hosting suffixes where every customer gets a subdomain; a passkey can never be bound to one.
public_suffixes=" netlify.app run.app a.run.app web.app firebaseapp.com vercel.app pages.dev "
# Second-level labels that countries sell names under (example.co.uk, example.com.au).
country_second_levels=" ac co com edu gov govt ltd ne net or org plc sch "

# scheme://host[:port] of a URL, without a path or trailing slash.
origin_of() {
  local url="$1"
  local scheme="${url%%://*}"
  local rest="${url#*://}"
  echo "${scheme}://${rest%%/*}"
}

host_of() {
  local origin
  origin="$(origin_of "$1")"
  local hostport="${origin#*://}"
  echo "${hostport%%:*}"
}

# Whether a domain is something anyone can register names under, so never an rpID: a single
# label, a hosting suffix, or a country second level such as co.uk.
is_public_suffix() {
  local domain="$1"
  if [[ "$domain" != *.* ]] || [[ "$public_suffixes" == *" ${domain} "* ]]; then
    return 0
  fi
  local first="${domain%%.*}"
  local rest="${domain#*.}"
  if [[ "$rest" != *.* ]] && [ "${#rest}" -eq 2 ] && [[ "$country_second_levels" == *" ${first} "* ]]; then
    return 0
  fi
  return 1
}

# The stable passkey rpID: STABLE_PASSKEY_RP_ID when set, else the frontend host's parent
# domain when the backend host is on it too and it is not a public suffix, else nothing (the
# app then uses the frontend host).
stable_passkey_rp_id() {
  local frontend_host="$1"
  local backend_host="$2"
  if [ -n "${STABLE_PASSKEY_RP_ID:-}" ]; then
    echo "$STABLE_PASSKEY_RP_ID"
    return 0
  fi
  if [[ "$frontend_host" != *.* ]]; then
    return 0
  fi
  local parent="${frontend_host#*.}"
  if is_public_suffix "$parent"; then
    return 0
  fi
  if [ "$backend_host" = "$parent" ] || [[ "$backend_host" == *".${parent}" ]]; then
    echo "$parent"
  fi
}

print_env() {
  local tag="$1"
  local stable_backend stable_frontend
  stable_backend="$(origin_of "$stable_backend_url")"
  stable_frontend="$(origin_of "$stable_frontend_url")"

  if [ "$tag" = "prod" ]; then
    local cors="$stable_frontend"
    # During the move to one domain the old Netlify host keeps working too.
    if [ "$stable_frontend" != "$legacy_frontend_url" ]; then
      cors="${cors},${legacy_frontend_url}"
    fi
    echo "CORS_ORIGINS=${cors}"
    echo "FRONTEND_URL=${stable_frontend}"
    echo "BETTER_AUTH_URL=${stable_backend}"
    # Stable runs oauth-proxy too, naming itself: its callback forwards each preview's return.
    echo "OAUTH_PROXY_PRODUCTION_URL=${stable_backend}"
    local rp_id
    rp_id="$(stable_passkey_rp_id "$(host_of "$stable_frontend")" "$(host_of "$stable_backend")")"
    if [ -n "$rp_id" ]; then
      echo "PASSKEY_RP_ID=${rp_id}"
    fi
    return 0
  fi

  local pr_number="${tag#pr-}"
  local preview_frontend="https://pr-${pr_number}--${netlify_site_host}"
  echo "CORS_ORIGINS=${preview_frontend}"
  # Passkeys on a preview bind to its own host: netlify.app is a public suffix.
  echo "FRONTEND_URL=${preview_frontend}"
  echo "BETTER_AUTH_URL=https://${tag}---${cloud_run_backend_url#https://}"
  echo "OAUTH_PROXY_PRODUCTION_URL=${stable_backend}"
}

# Env var -> secret name suffix. Terraform (infra/flourish/main.tf) creates the containers.
oauth_secrets=(
  "GOOGLE_CLIENT_ID=google-client-id"
  "GOOGLE_CLIENT_SECRET=google-client-secret"
  "GITHUB_CLIENT_ID=github-client-id"
  "GITHUB_CLIENT_SECRET=github-client-secret"
  "APPLE_CLIENT_ID=apple-client-id"
  "APPLE_TEAM_ID=apple-team-id"
  "APPLE_KEY_ID=apple-key-id"
  "APPLE_PRIVATE_KEY=apple-private-key"
)

print_secrets() {
  local tag="$1"
  local service="${GCP_BACKEND_SERVICE:-terreno-backend-example}"
  local entry name secret
  for entry in "${oauth_secrets[@]}"; do
    name="${entry%%=*}"
    # A preview only starts sign-ins, which need the client ID; stable exchanges the code, so
    # client secrets and the Apple key never reach a pr-* revision.
    if [ "$tag" != "prod" ] && [[ "$name" != *_CLIENT_ID ]]; then
      continue
    fi
    secret="${service}-${entry#*=}"
    # Cloud Run refuses a deploy that mounts a secret with no version, so skip empty containers.
    if gcloud secrets versions access latest --secret="$secret" >/dev/null 2>&1; then
      echo "${name}=${secret}:latest"
    fi
  done
}

check_tag() {
  if [ "$1" != "prod" ] && ! [[ "$1" =~ ^pr-[0-9]+$ ]]; then
    echo "Unknown deploy tag: $1 (expected prod or pr-N)" >&2
    exit 2
  fi
}

case "${1:-}" in
  env)
    if [ "$#" -ne 2 ]; then
      echo "Usage: $0 env <prod|pr-N>" >&2
      exit 2
    fi
    check_tag "$2"
    print_env "$2"
    ;;
  gcloud-env)
    if [ "$#" -ne 3 ]; then
      echo "Usage: $0 gcloud-env <prod|pr-N> <comma-separated base env vars>" >&2
      exit 2
    fi
    check_tag "$2"
    auth_env="$(print_env "$2")"
    base="$3"
    echo "^;^${base//,/;};${auth_env//$'\n'/;}"
    ;;
  secrets)
    if [ "$#" -ne 2 ]; then
      echo "Usage: $0 secrets <prod|pr-N>" >&2
      exit 2
    fi
    check_tag "$2"
    print_secrets "$2"
    ;;
  *)
    echo "Usage: $0 <env <tag>|gcloud-env <tag> <base>|secrets <tag>>" >&2
    exit 2
    ;;
esac
