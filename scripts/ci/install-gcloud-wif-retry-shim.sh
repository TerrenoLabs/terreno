#!/usr/bin/env bash
set -euo pipefail

real_gcloud="$(command -v gcloud)"
shim_directory="${RUNNER_TEMP:?RUNNER_TEMP must be set}/gcloud-wif-retry"
retry_script="${GITHUB_WORKSPACE:?GITHUB_WORKSPACE must be set}/scripts/ci/gcloud-with-wif-retry.sh"

mkdir -p "$shim_directory"
chmod +x "$retry_script"

printf '#!/usr/bin/env bash\nexport GCLOUD_WIF_RETRY_REAL=%q\nexec %q "$@"\n' \
  "$real_gcloud" \
  "$retry_script" \
  >"$shim_directory/gcloud"
chmod +x "$shim_directory/gcloud"

echo "$shim_directory" >>"${GITHUB_PATH:?GITHUB_PATH must be set}"
