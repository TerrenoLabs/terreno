# Task List: @terreno/syncdb-codegen

Paired with [docs/implementationPlans/syncdb-codegen.md](../implementationPlans/syncdb-codegen.md). **Delivery: single PR** — phases define implementation order only.

## Phase 1: syncdb runtime

- [x] **Task 1.1**: Per-mutation `maxAttempts` plumbing
  - Description: Add optional `maxAttempts` to `MutateArgs`, store it as an optional cell on the outbox row, and have the replay coordinator's `error`-nack branch use `row.maxAttempts ?? MAX_ERROR_NACK_ATTEMPTS` when deciding terminal failure. Missing cell keeps current behavior.
  - Files: `syncdb/src/client.ts`, `syncdb/src/mutations/outbox.ts`, `syncdb/src/storage/schema.ts`, `syncdb/src/sync/replayCoordinator.ts`, `syncdb/src/sync/replayCoordinator.test.ts`, `syncdb/src/mutations/outbox.test.ts`
  - Depends on: none
  - Acceptance: `maxAttempts: 1` fails terminally after one error nack; omitted preserves 5-attempt exponential backoff; existing tests unchanged.

- [x] **Task 1.2**: `createCollectionHooks` factory
  - Description: New `createCollectionHooks<TData, TCreate, TUpdate>({collection, retries})` in `@terreno/syncdb/react` returning the five per-operation hooks `{useListQuery, useReadQuery, useCreateMutation, useUpdateMutation, useDeleteMutation}`. Read hooks delegate to the existing `useQuery`/`useEntity`; mutation hooks return one-element `[trigger]` tuples whose triggers wrap `client.mutate`, mapping `retries` (false → 1, number → n, omitted → undefined) to `maxAttempts`.
  - Files: `syncdb/src/react/collectionHooks.ts` (new), `syncdb/src/react/collectionHooks.test.tsx` (new), `syncdb/src/react/index.ts`
  - Depends on: Task 1.1
  - Acceptance: factory hooks behave identically to direct hook calls; `const [create] = useCreateMutation()` destructuring compiles and works; typed create/update payloads compile; `retries` reaches the outbox row.

## Phase 2: OpenAPI extension in @terreno/api

- [x] **Task 2.1**: Emit `x-terreno-sync` on list operations
  - Description: When `modelRouter` options include `sync`, the list operation's OpenAPI object gains `"x-terreno-sync": {collection, scope}` where `collection` is the route path without the leading slash and `scope` is the scope type ("owner" | "tenant" | "broadcast" | "custom"). Thread `routePath` into `listOpenApiMiddleware` so `collection` matches `syncRegistry` `collectionTag`.
  - Files: `api/src/openApi.ts`, `api/src/api.ts` (call site), `api/src/openApi.test.ts` (or existing spec-generation test file)
  - Depends on: none
  - Acceptance: spec for a synced model contains the extension with correct collection tag and scope; non-synced routes contain no extension; RTK codegen output for example-frontend is unchanged.

## Phase 3: codegen CLI (`@terreno/syncdb`)

- [x] **Task 3.1**: Bin scaffold
  - Description: Add `terreno-syncdb-codegen` bin and `build:binary` to `@terreno/syncdb` (`src/codegen/cli.ts` with `#!/usr/bin/env bun`), modeled on the `mcp-server` bin pattern. No new workspace package.
  - Files: `syncdb/package.json`, `syncdb/src/codegen/cli.ts`
  - Depends on: none
  - Acceptance: `bun syncdb/src/codegen/cli.ts --help`-equivalent missing-args usage exits 1; `bun run lint` in syncdb passes.

- [x] **Task 3.2**: Spec loading and collection discovery
  - Description: Load the OpenAPI document from a URL or file path; walk `paths` for `x-terreno-sync` extensions; resolve each collection's entity schema (list response `data` items ref), create body, and update body schema refs; apply `--collections` as filter or fallback; fail with an actionable error when no collections resolve.
  - Files: `syncdb/src/codegen/loadSpec.ts`, `syncdb/src/codegen/discoverCollections.ts`, tests, `syncdb/src/codegen/fixtures/openapi.example.json`
  - Depends on: Task 2.1, Task 3.1
  - Acceptance: fixture spec yields todos; missing extensions + no flag exits non-zero.

- [x] **Task 3.3**: Type and SDK emitters
  - Description: Emit TS interfaces from the OpenAPI schema subset, then assemble the output file with friendly hook names (`useTodos`, `useTodo`, `useCreateTodo`, `useUpdateTodo`, `useDeleteTodo`).
  - Files: `syncdb/src/codegen/emitTypes.ts`, `syncdb/src/codegen/emitSdk.ts`, `syncdb/src/codegen/hookNames.ts`, tests
  - Depends on: Task 3.2
  - Acceptance: todos fixture emits friendly hooks; retries override appears in the factory call.

- [x] **Task 3.4**: CLI entry and binary build
  - Description: `cli.ts` wires arg parsing → load → discover → emit → write. Verify `build:binary` produces a standalone executable.
  - Files: `syncdb/src/codegen/cli.ts`, `syncdb/src/codegen/cli.test.ts`
  - Depends on: Task 3.3
  - Acceptance: missing required args print usage and exit 1; `--schema` fixture write succeeds.

## Phase 4: Integration and docs

- [x] **Task 4.1**: example-frontend integration
  - Description: Add `sync-sdk` script and `syncdb-codegen.json`, check in generated `store/syncDbSdk.ts` (todos collection only), source `SYNC_COLLECTIONS` from it in `store/syncdb.ts`, and migrate `SyncTodosScreen` to generated `useTodo` / `useCreateTodo` / `useUpdateTodo` / `useDeleteTodo` (keep `useEntityIds` for list virtualization).
  - Files: `example-frontend/package.json`, `example-frontend/syncdb-codegen.json`, `example-frontend/store/syncDbSdk.ts`, `example-frontend/store/syncdb.ts`, `example-frontend/components/SyncTodosScreen.tsx`
  - Depends on: Task 1.2, Task 3.4
  - Acceptance: generated hooks are the screen's mutate/read path; `SYNC_COLLECTIONS` feeds `createSyncDb`.

- [x] **Task 4.2**: Documentation
  - Description: Codegen section in `syncdb/README.md` and `docs/reference/syncdb.md`, plus the RTK migration guide mapping.
  - Files: `syncdb/README.md`, `docs/how-to/migrate-rtk-to-syncdb.md`, `docs/reference/syncdb.md`
  - Depends on: Task 4.1
  - Acceptance: docs cover generation, custom hooks, retries overrides, and friendly names.

- [x] **Task 4.3**: npm publish
  - Description: Codegen ships inside `@terreno/syncdb`. Do not add `publish-syncdb-codegen` or a second package.
  - Files: none
  - Depends on: Task 3.1
  - Acceptance: no new workspace package; existing `publish-syncdb` covers the bin.
