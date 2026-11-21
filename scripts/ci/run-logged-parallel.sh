#!/bin/sh
# Run named commands at the same time. Each argument is name=command.
# Prints a heartbeat so a quiet CircleCI step is not killed, then dumps each
# log with its exit code. The step fails with the last non-zero status.
set -u

if [ "$#" -lt 1 ]; then
  echo "usage: run-logged-parallel.sh name=command ..." >&2
  exit 2
fi

dir=$(mktemp -d)
i=0
for spec in "$@"; do
  name=${spec%%=*}
  cmd=${spec#*=}
  if [ -z "$name" ] || [ "$name" = "$spec" ]; then
    echo "expected name=command, got: $spec" >&2
    exit 2
  fi
  echo "$name" > "$dir/$i.name"
  # shellcheck disable=SC2094
  sh -c "$cmd" > "$dir/$i.log" 2>&1 &
  echo $! > "$dir/$i.pid"
  i=$((i + 1))
done
count=$i

while true; do
  alive=0
  i=0
  while [ "$i" -lt "$count" ]; do
    pid=$(cat "$dir/$i.pid")
    if kill -0 "$pid" 2>/dev/null; then
      alive=1
    fi
    i=$((i + 1))
  done
  if [ "$alive" -eq 0 ]; then
    break
  fi
  echo "parallel still running"
  sleep 20
done

fail=0
i=0
while [ "$i" -lt "$count" ]; do
  pid=$(cat "$dir/$i.pid")
  name=$(cat "$dir/$i.name")
  status=0
  wait "$pid" || status=$?
  echo "===== $name (exit $status) ====="
  cat "$dir/$i.log"
  if [ "$status" -ne 0 ]; then
    fail=$status
  fi
  i=$((i + 1))
done

rm -rf "$dir"
exit "$fail"
