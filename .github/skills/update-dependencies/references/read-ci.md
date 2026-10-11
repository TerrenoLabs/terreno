# Read CI failures

Classify a failure before acting on it. A job that never started cannot be
fixed by changing a dependency.

CircleCI project slug: `circleci/6UHiK7pThPXbhnNi3umQNe/LdjghuhydHjFMyFjcEXMA2`
(not `gh/TerrenoLabs/terreno`). Token: `CIRCLECI_TOKEN` as the `Circle-Token`
header. More: [`docs/how-to/circleci.md`](../../../docs/how-to/circleci.md).

## 1. Failed jobs on the pushed head

```bash
S=circleci/6UHiK7pThPXbhnNi3umQNe/LdjghuhydHjFMyFjcEXMA2
H="Circle-Token: $CIRCLECI_TOKEN"
P=$(curl -s -H "$H" "https://circleci.com/api/v2/project/$S/pipeline?branch=chore/update-dependencies" | jq -r '.items[0].id')
curl -s -H "$H" "https://circleci.com/api/v2/pipeline/$P/workflow" \
  | jq -r '.items[] | select(.status=="failed") | .id' \
  | while read -r w; do
      curl -s -H "$H" "https://circleci.com/api/v2/workflow/$w/job" \
        | jq -r '.items[] | select(.status=="failed") | "\(.name) \(.job_number)"'
    done
```

Check that the pipeline's commit is the head you pushed.

## 2. Job `messages` first

```bash
curl -s -H "$H" "https://circleci.com/api/v2/project/$S/job/<job_number>" | jq '{name, status, messages}'
```

A non-empty `messages` array means the job failed **before or outside** its
steps. These are config, plan, or infra errors — log and stop:

| `reason` | Meaning |
| --- | --- |
| `resource-class-not-in-plan` | Config asks for a resource class the plan lacks |
| `context-restricted` / missing context | Secrets not available to this branch or actor |
| `config-error` / setup failure | Config does not compile |

## 3. Step logs second

Only when `messages` is empty:

```bash
curl -s -H "$H" "https://circleci.com/api/v1.1/project/$S/<job_number>" \
  | jq -r '.steps[].actions[] | select(.status != "success") | "\(.name)|\(.output_url)"'
curl -s "<output_url>" | jq -r '.[].message' | tail -c 4000
```

Copy the failing test file and case, run the matching local command from
[`verify-locally.md`](verify-locally.md), and confirm it fails locally before
you change anything. A failure that does not reproduce locally and is not
caused by a bump (flake, timeout, OOM in an unchanged job) goes in the PR body
for a human; do not change CI config to work around it.

## GitHub-hosted checks

`gh pr checks <number>` covers GitHub Actions, CodeQL, and Cursor bots. Read a
failed run with `gh run view <id> --log-failed`.
