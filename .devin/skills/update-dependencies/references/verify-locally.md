# Verify locally before push

The rolling PR gets one push per run. Everything CI would catch for a
dependency bump has to fail here first. Source of truth for the CI → local
map: [`docs/how-to/run-tests-locally.md`](../../../docs/how-to/run-tests-locally.md).

## Per bump (step 4)

```bash
bun install
bun test --only-failures <exercise-test-path>
cd <consuming-package> && bun run compile && bun run lint
```

## Batch gate (step 5)

From the repo root on the final stacked head:

```bash
bun run compile
bun run lint
bun run prepush --dry-run   # read the plan: which CI jobs this branch triggers
bun run prepush             # runs every triggered job's local command
```

`prepush` runs every step even after a failure. Fix or revert until one pass is
green. For each package the bumps touched, also run its package test row below
if `prepush` did not.

| CircleCI job | Local command |
| --- | --- |
| `api-ci` | `bun run api:test` |
| `ai-ci` | `cd ai && bun run test:ci` |
| `ui-ci` | `bun run ui:test` |
| `rtk-ci` | `bun run rtk:test` |
| `syncdb-ci` | `bun run syncdb:test` |
| `example-backend-ci` | `cd example-backend && bun run test:ci` |
| `example-frontend-ci` | `bun run frontend:test` |
| `packages-ci` | `cd <package> && bun run test:ci` |
| `repo-policies` | `bun run prepush` |

The doc above lists the rest (`blocks`, `comms`, `jobs`, `mcp-server`, demo).

## Infra jobs `prepush` only lists

`prepush` prints these with the command to run by hand. Run the one whose
package a bump touched; otherwise record "not run locally" in the PR body.

| CircleCI job | When a bump touches | Local command |
| --- | --- | --- |
| `e2e` (Playwright) | example-frontend, ui, rtk, syncdb, api | `bun run check:e2e-affected`, then `bun run frontend:e2e` or the named shard |
| `maestro-e2e` | example-frontend, ui, demo | `bun run maestro:test` |
| `admin-spa-integration` | admin-spa, admin-frontend, admin-backend | `cd admin-spa && bun run test:integration` |

These need a replica-set `mongod`; setup is in the doc above.

## Frontend bumps

A bump that changes what `ui`, `example-frontend`, `demo`, or `admin-*` render
needs `verify-ui-changes` evidence (launch, log in, exercise, screenshot) in
the PR body.
