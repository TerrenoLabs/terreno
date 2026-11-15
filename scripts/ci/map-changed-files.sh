#!/usr/bin/env bash
# Turn the CircleCI setup mapping into continuation pipeline parameters.
#
# Each mapping line is "<path regex> <pipeline parameter> <value>". A line sets
# its parameter when any file changed between the base revision and this commit
# matches the regex, anchored as ^regex$ (the path-filtering orb's semantics).
#
# The path-filtering orb runs one grep per (mapping line, changed file) pair.
# A docs cut changes ~1,700 files, which made that ~470k processes and hit
# CircleCI's 10-minute no-output timeout. Here every mapping line runs one grep
# over the whole changed-file list instead.
#
# Env:
#   MAPPING        mapping text, or a path to a file holding it
#   BASE_REVISION  branch to compare against (default: master)
#   CIRCLE_SHA1    commit under test (default: HEAD)
#   OUTPUT_PATH    where to write the parameters JSON (default: /tmp/pipeline-parameters.json)
#   CHANGED_FILES_PATH  where to write the changed-file list (default: /tmp/files-changed-list)
set -euo pipefail

mapping="${MAPPING:-}"
base_revision="${BASE_REVISION:-master}"
head_sha="${CIRCLE_SHA1:-$(git rev-parse HEAD)}"
output_path="${OUTPUT_PATH:-/tmp/pipeline-parameters.json}"
changed_files_path="${CHANGED_FILES_PATH:-/tmp/files-changed-list}"

if [ -z "$mapping" ]; then
  echo "map-changed-files: MAPPING is empty" >&2
  exit 1
fi
if [ -f "$mapping" ]; then
  mapping="$(cat "$mapping")"
fi
command -v jq >/dev/null 2>&1 || {
  echo "map-changed-files: jq is required" >&2
  exit 1
}

resolve_base() {
  local ref
  for ref in "$base_revision" "origin/$base_revision"; do
    if git rev-parse --verify --quiet "$ref^{commit}" >/dev/null; then
      echo "$ref"
      return 0
    fi
  done
  if git fetch --quiet origin "$base_revision" 2>/dev/null; then
    echo "FETCH_HEAD"
    return 0
  fi
  return 1
}

base_ref="$(resolve_base)" || {
  echo "map-changed-files: base revision '$base_revision' not found" >&2
  exit 1
}

merge_base="$(git merge-base "$base_ref" "$head_sha")"
if [ "$merge_base" = "$(git rev-parse "$head_sha")" ]; then
  # On the base branch itself, compare with the previous commit.
  if git rev-parse --verify --quiet "$head_sha~1" >/dev/null; then
    merge_base="$(git rev-parse "$head_sha~1")"
  else
    merge_base="$(git hash-object -t tree /dev/null)"
  fi
fi

echo "Comparing $merge_base...$head_sha"
git -c core.quotepath=false diff --name-only "$merge_base" "$head_sha" >"$changed_files_path"
echo "$(wc -l <"$changed_files_path" | tr -d ' ') changed files"

declare -A parameters=()
declare -a order=()
while IFS= read -r line; do
  trimmed="$(echo "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  if [ -z "$trimmed" ] || [[ "$trimmed" == \#* ]]; then
    continue
  fi
  read -ra tokens <<<"$trimmed"
  if [ "${#tokens[@]}" -ne 3 ]; then
    echo "map-changed-files: expected '<regex> <parameter> <value>', got: $trimmed" >&2
    exit 1
  fi
  regex="${tokens[0]}"
  name="${tokens[1]}"
  value="${tokens[2]}"
  if grep -qP -- "^${regex}\$" "$changed_files_path"; then
    # Like the orb, a later matching line for the same parameter wins.
    if [ -z "${parameters[$name]+set}" ]; then
      order+=("$name")
    fi
    parameters[$name]="$value"
  fi
done <<<"$mapping"

json="{}"
for name in "${order[@]+"${order[@]}"}"; do
  value="${parameters[$name]}"
  if echo "$value" | jq . >/dev/null 2>&1; then
    json="$(jq -c --arg key "$name" --argjson value "$value" '. + {($key): $value}' <<<"$json")"
  else
    json="$(jq -c --arg key "$name" --arg value "$value" '. + {($key): $value}' <<<"$json")"
  fi
done

echo "$json" >"$output_path"
echo "Pipeline parameters: $json"
