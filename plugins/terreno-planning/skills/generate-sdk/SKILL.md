---
name: generate-sdk
description: >-
  Regenerate the example-frontend SDKs from the example-backend's OpenAPI spec
  with terreno-syncdb-codegen: store/apiSdk.ts (typed request hooks for every
  non-synced route, `bun run sdk`) and store/syncDbSdk.ts (synced collection
  hooks, `bun run sync-sdk`). Handles dependency install, backend startup,
  codegen, and cleanup from a fresh checkout. Use whenever the backend's API
  surface changes — new modelRouter routes or actions, custom routes registered
  via createOpenApiBuilder, new/modified Mongoose models or field descriptions
  in example-backend, sync config changes, changes to
  permissions/queryFields/populatePaths/responseHandler, edits to @terreno/api
  routing or OpenAPI generation, or any time a route is added/removed/renamed.
  Also use when the user asks to "regenerate the SDK", "update apiSdk.ts" or
  "syncDbSdk.ts", "run bun run sdk" or "bun run sync-sdk", or reports
  stale/missing generated hooks. Lifecycle composition: Pick after API-shape
  changes; Roast to verify generated-client compatibility.
targets:
  - '*'
---
# Generate Frontend SDK

Regenerates the two generated files in `example-frontend` from the live backend spec at
`http://localhost:4000/openapi.json` (or `OPENAPI_URL`). Both come from
`terreno-syncdb-codegen` in `@terreno/syncdb`.

| Command | Output | Covers |
|---------|--------|--------|
| `bun run sdk` (runs `api-sdk`) | `store/apiSdk.ts` | Every operation without `x-terreno-sync`: `/auth/me`, modelRouter actions, AI, consents, announcements, version check |
| `bun run sync-sdk` | `store/syncDbSdk.ts` | `SYNC_COLLECTIONS` + collection hooks for the collections in the script's `--collections` list |

**Never edit `store/apiSdk.ts` or `store/syncDbSdk.ts` by hand — codegen overwrites them.**
Codegen options live in `example-frontend/syncdb-codegen.json` (`excludePaths` drops
routes such as the SSE streams; `overrides` sets per-collection options). Built-in admin
uses admin-frontend's own fetch client and is not generated here.

## Documentation

Read `docs/reference/syncdb.md#codegen` and `docs/how-to/generate-the-client-sdk.md`
before regenerating. After a public API change, run `update-docs` in the same slice.

## When to run this skill

Run `sdk` when the non-synced OpenAPI surface changes; run `sync-sdk` when a synced
collection's schema or `sync` config changes. Run both when unsure. Triggers:

- New or removed `modelRouter` registration, `collectionActions`, or `instanceActions`
- Edits to `permissions`, `queryFields`, `populatePaths`, `defaultQueryParams`, `sort`, `responseHandler`, `sync`, or `openApiOverwrite`
- New custom routes built with `createOpenApiBuilder`
- Mongoose schema changes that affect the public shape (fields, types, required/enum/default, `description`, refs)
- Auth route changes (`addAuthRoutes`, `addMeRoutes`, GitHub OAuth, Better Auth)
- Edits to `@terreno/api` OpenAPI generation (`openApi.ts`, `openApiBuilder.ts`, `api.ts`, `populate.ts`) or to `syncdb/src/codegen/`
- A new synced collection: also add it to the `--collections` list in the `sync-sdk` script

Skip it for backend-internal changes (logging, refactors that keep routes and models, tests).

## Prerequisites

- Bun on PATH (run `bun` directly; do not modify PATH)
- A MongoDB **replica set** at `MONGO_URI` (the backend's change streams need one)
- Port 4000 free

## Procedure

Run the steps in order. Stop and report on the first failure.

### 1. Verify the worktree is bootstrapped

```bash
test -d node_modules && test -d example-backend/node_modules && test -d example-frontend/node_modules && echo "installed" || echo "missing"
```

If `missing`, run `bun run bootstrap` from the repo root in the background and wait for it.
It installs deps and compiles every workspace package.

### 2. Start MongoDB if it is not running

`mongosh --quiet --eval 'rs.status().ok'` (or a `node` MongoClient ping) succeeds when a
replica set is up. Otherwise start one from the `mongodb-memory-server` binary cache and
initiate it once, as in `/workspace/CLAUDE.md` ("Example full stack"):

```bash
mkdir -p .devdata/mongo
"$(ls ~/.cache/mongodb-binaries/mongod-* | head -1)" \
  --replSet rs0 --port 27017 --bind_ip 127.0.0.1 --dbpath .devdata/mongo
```

Run `mongod` in the background. Initiate the replica set with `node` (not `bun`) from
`example-backend/`. If no `mongod` binary exists, tell the user and stop.

### 3. Ensure backend env vars are set

```bash
test -f example-backend/.env || cp example-backend/.env.example example-backend/.env
```

The example values (`MONGO_URI=mongodb://127.0.0.1:27017/terreno-example?replicaSet=rs0`,
token and session secrets) are fine for codegen. Never overwrite an existing `.env`.

### 4. Start the example backend on port 4000

```bash
bun run backend:dev
```

Use `run_in_background: true`.

### 5. Wait for the OpenAPI spec

Poll until the spec returns 200 (5–20 s on a cold start). Codegen against a backend that is
not ready fails or emits an empty SDK.

```bash
until curl -sf -o /dev/null http://localhost:4000/openapi.json; do sleep 2; done
```

If the backend logs an error (Mongo connection refused, port in use, compile error), stop
and report it.

### 6. Generate

```bash
cd example-frontend && bun run sdk && bun run sync-sdk
```

Both scripts format their output with Biome. A non-zero exit names the problem: two
operations sharing a hook name (give one an `operationId`), a missing collection path, or a
list response without `data.items`.

### 7. Stop the backend

Kill the background backend you started (and `mongod`, if you started it):

```bash
pkill -f "example-backend.*src/index.ts" || true
```

### 8. Verify and report

```bash
git diff --stat example-frontend/store/apiSdk.ts example-frontend/store/syncDbSdk.ts
cd example-frontend && bunx tsc --noEmit
```

Report which backend changes triggered the run, the diff stat, and any codegen or compile
errors. Do not commit the generated files automatically.

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `ECONNREFUSED 127.0.0.1:27017` | MongoDB not running | Step 2 |
| Backend boots but change streams fail | Mongo is not a replica set | Start `mongod --replSet rs0` and initiate it |
| `EADDRINUSE :::4000` | Stale backend process | `pkill -f "example-backend.*src/index.ts"`, then retry |
| `fetch failed` / empty output | Backend not ready when codegen ran | Redo step 5 |
| Duplicate hook name error | Two operations map to one name | Add an `operationId` to one route |
| Screen imports a hook that no longer exists | Route renamed or excluded | Update the import; check `excludePaths` in `syncdb-codegen.json` |

## Notes

- Script definitions: `example-frontend/package.json` (`api-sdk`, `sdk`, `sync-sdk`). They run
  `syncdb/src/codegen/cli.ts` directly; consumer apps call the `terreno-syncdb-codegen` bin.
- Hook names match the old RTK codegen rule (`GET /auth/me` → `useGetAuthMeQuery`), so
  migrated screens keep their names. Apps upgrading from `@terreno/rtk` follow
  `docs/how-to/migrate-rtk-to-syncdb.md`.
