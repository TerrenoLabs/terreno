# Implementation Plan: @terreno/syncdb-codegen

**Status:** In progress
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1087
**Branch:** cursor/syncdb-codegen-in-package-746d
**Owner:**
**Created:** 2026-07-08
**Approved:** 2026-08-20
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1110
**Research:** [syncdb-codegen-research.md](./syncdb-codegen-research.md)

## Goal

Ship **`terreno-syncdb-codegen` as a bin of `@terreno/syncdb`** (not a separate workspace package): a CLI that reads a backend OpenAPI spec and generates a static, typed set of syncdb hooks — the local-first analogue of `@rtk-query/codegen-openapi` (`bun run sync-sdk` → `store/syncDbSdk.ts`).

Today syncdb consumers hand-write both the entity types and the collection strings:

```typescript
// example-frontend/components/SyncTodosScreen.tsx — all manual today
interface SyncTodo { _id: string; title?: string; completed?: boolean; created?: string; }
const todos = useQuery<SyncTodo>("todos", {sort: sortByCreatedDesc});
const {update, remove} = useMutate("todos"); // update/remove payloads are Record<string, unknown>
```

After this IP, a generated `store/syncDbSdk.ts` provides one hook per operation with **friendly, entity-centric names** — `useTodos` (list), `useTodo` (read by id), `useCreateTodo`, `useUpdateTodo`, `useDeleteTodo` — with payload types derived from the same OpenAPI schemas RTK codegen uses (`Todo`, `CreateTodoBody`, `UpdateTodoBody`), plus a `SYNC_COLLECTIONS` constant that feeds `createSyncDb`. Names deliberately differ from RTK codegen so `openApiSdk.ts` and `syncDbSdk.ts` can coexist without collision during migration. Mutation hooks still use one-element `[trigger]` tuples for familiar destructuring; triggers are syncdb-native (no `.unwrap()`). Custom hooks are supported the same way RTK supports custom endpoints: the generated file is never edited, and consumers extend it in a sibling file using `createCollectionHooks`.

## Non-Goals

- Covering the whole syncdb surface. Only the five CRUD operations (list query, read, create, update/patch, delete) get generated per-collection hooks. `useSyncStatus`, `useConflicts`, `useSyncDbClient`, and `SyncDbProvider` are global (not per-collection) and stay as direct imports from `@terreno/syncdb/react`.
- Full RTK return-shape emulation. Hook **names** are syncdb-friendly (not RTK-derived); mutation hooks use `[trigger]` tuples only. Return shapes are syncdb-native (no `isLoading`/`error` async state on mutations — writes are synchronous local applies plus a durable outbox; sync state lives in `useSyncStatus`). The RTK ↔ syncdb mapping is documented in the generated file header and the migration guide.
- Runtime schema validation of mutation payloads (types are compile-time only, matching RTK codegen).
- Publishing per-platform compiled binaries as GitHub release artifacts (the compiled binary remains a local/CI `build:binary` target).
- Watch mode, incremental generation, or multi-output-file support.
- Generating Redux integration or migrating non-synced endpoints — per `docs/how-to/migrate-rtk-to-syncdb.md`, custom routes stay on RTK.

## Decisions

Options were considered where the design was genuinely open; each row records the recommendation this plan is built on. Rejected alternatives are listed so review can overrule them cheaply.

| Question | Decision |
|----------|----------|
| **How does codegen know which collections are synced?** OpenAPI does not mark sync today; the server-side `syncRegistry` (`api/src/sync/registry.ts`) is in-memory only. Options: (a) emit an `x-terreno-sync` vendor extension on the list path from `modelRouter` when `options.sync` is set; (b) require an explicit `--collections` CLI arg; (c) add a `GET /sync/config` manifest endpoint. | **(a) with (b) as override.** The extension is a ~10-line change in `@terreno/api`'s list OpenAPI middleware, keeps the spec the single input (same as RTK codegen), and can't drift from the backend. `--collections` remains as an explicit filter/override for apps that sync a subset. (c) adds server surface for no extra information and is rejected. |
| **How is "retries vs not" expressed?** RTK disables retries per-endpoint via `extraOptions: {maxRetries: 0}` (see `rtk/src/authSlice.ts`). syncdb retries live in the replay engine: `MAX_ERROR_NACK_ATTEMPTS = 5` with exponential backoff in `syncdb/src/sync/replayCoordinator.ts`, not configurable per mutation. Options: (a) plumb an optional per-mutation `maxAttempts` through `client.mutate` → outbox row → replay coordinator, and expose `retries` in the codegen config; (b) codegen-only option that is silently ignored until the engine supports it. | **(a).** Small, contained change: `MutateArgs.maxAttempts?`, one optional outbox cell, one `??` in the replay coordinator's error-nack branch. `retries: false` maps to `maxAttempts: 1` (fail fast, like RTK's `maxRetries: 0`), a number maps directly, and omitted keeps the engine default of 5. (b) would generate config that lies. Note syncdb mutations are idempotent via `mutationId`, so unlike RTK the motivation is fail-fast UX (surface a terminal failure immediately), not duplicate-write safety. |
| **Config surface: flags only, or a config file?** The binary should "take a few args", but per-collection overrides (retries, exclusions) don't map well to flags. | **Flags for the common path, optional JSON config for overrides.** `--schema`, `--out`, `--collections` cover the RTK-equivalent happy path. `--config ./syncdb-codegen.json` adds `{overrides: {<collection>: {retries?: boolean \| number}}, exportName?, sdkImportPath?}`. JSON (not TS) because a compiled bun binary cannot reliably import arbitrary consumer TypeScript at runtime; RTK's TS `ConfigFile` needs the `tsx`/`TS_NODE_PROJECT` dance we currently work around in `example-frontend/scripts/generate-sdk.ts`. |
| **How are TS types emitted from OpenAPI schemas?** Options: (a) a small hand-rolled emitter for the subset `mongoose-to-swagger` actually produces (objects, primitives, enums as string unions, arrays, `$ref`); (b) depend on `openapi-typescript` or oazapfts. | **(a).** The @terreno/api spec is a narrow, known dialect; a ~150-line emitter with snapshot tests keeps the binary dependency-free and small. If the emitter grows past that dialect, revisit (b). |
| **Where does the shared hook factory live?** Generated code and custom hooks must be built the same way (the RTK parallel: generated `injectEndpoints` and app `sdk.ts` both build on `emptySplitApi`). Options: (a) new `createCollectionHooks` export in `@terreno/syncdb/react`; (b) inline the factory into every generated file; (c) a runtime export of `@terreno/syncdb-codegen`. | **(a).** One implementation, versioned with the hooks it wraps, and consumers already depend on `@terreno/syncdb`. (b) duplicates logic into generated output; (c) would make the codegen package a runtime dependency of apps, which it should never be. |
| **Hook granularity and naming.** Options: (a) one grouped `useTodosMutate()` returning `{create, update, remove}`; (b) one hook per operation with RTK codegen's exact naming scheme (`use{Method}{Path}Query/Mutation`); (c) per-operation hooks with friendlier names (`useCreateTodo`). | **(c) — per-operation, friendly names.** Generated per collection (entity `Todo`, collection `todos`): `useTodos`, `useTodo`, `useCreateTodo`, `useUpdateTodo`, `useDeleteTodo`. Derivation: `entityName` from the list-item schema `$ref` basename (`Todo`); `pluralName` = PascalCase of the collection path segment (`todos` → `Todos`). List hook `use{Plural}`; read hook `use{Entity}`; mutations `useCreate{Entity}`, `useUpdate{Entity}`, `useDelete{Entity}`. No collision with RTK hooks during dual-stack migration. "Update" and "patch" are the same hook — modelRouter only exposes PATCH (merge semantics). |
| **Mutation hook return shape.** RTK mutation hooks return `[trigger, {isLoading, error, ...}]` and triggers return promises with `.unwrap()`. syncdb writes are synchronous local applies; there is no per-call async state. | **One-element tuple `[trigger]`.** Keeps the RTK call site (`const [createTodo] = usePostTodosMutation()`) working unchanged; the trigger returns `{mutationId, id}` synchronously instead of a promise, so `.unwrap()`/`isLoading` usages are deleted during migration (the compiler flags them). Pending/conflict state is per-entity (`isPending` on reads) and global (`useSyncStatus`), not per-call. |
| **Distribution.** "Compiled bun binary" vs npm reality. | **Both, npm-bin first, published on tag.** The package ships `"bin": {"terreno-syncdb-codegen": "./dist/cli.js"}` with a `#!/usr/bin/env bun` shebang (the `@terreno/mcp` pattern), plus a `build:binary` script running `bun build --compile src/cli.ts --outfile dist/terreno-syncdb-codegen` for standalone use. Add `publish-syncdb-codegen` to `publish-on-tag.yml` (modeled on `publish-syncdb` / `publish-mcp`). |
| **Delivery shape.** Four phased PRs vs one. | **Single PR** — all runtime, api, codegen, integration, docs, and publish wiring land together. Task phases remain for implementation order inside the PR. |
| **example-frontend generated collections.** Backend syncs todos and projects; example app scope. | **todos only** in the checked-in `syncDbSdk.ts`; projects stay manual or a follow-up when a syncdb screen ships for them. |

## Architecture

```
example-backend                                example-frontend
  modelRouter("/todos", Todo, {sync: {...}})     bun run sync-sdk
    └─ list OpenAPI middleware emits               └─ terreno-syncdb-codegen
       x-terreno-sync on GET /todos                     --schema http://localhost:4000/openapi.json
            │                                           --out ./store/syncDbSdk.ts
            ▼                                                │
      /openapi.json  ──── fetch/read ────────────────────────┘
                                                             │ emits
                                                             ▼
                                              store/syncDbSdk.ts   (generated, never edited)
                                                ├─ interface Todo / CreateTodoBody / UpdateTodoBody
                                                ├─ export const SYNC_COLLECTIONS = ["todos"] as const
                                                └─ export const {useListQuery: useTodos, useReadQuery: useTodo,
                                                     useCreateMutation: useCreateTodo,
                                                     useUpdateMutation: useUpdateTodo,
                                                     useDeleteMutation: useDeleteTodo} =
                                                       createCollectionHooks<...>({collection: "todos"})
                                                             │ extended by (custom hooks)
                                                             ▼
                                              store/syncSdk.ts    (hand-written, optional)
                                                └─ createCollectionHooks<LocalNote>({collection: "notes"})
```

Two packages change:

1. **`@terreno/syncdb`** (runtime + CLI): `createCollectionHooks` factory in `src/react/`, per-mutation `maxAttempts` plumbing through `client.mutate` → outbox → replay coordinator, and `src/codegen/` (`terreno-syncdb-codegen` bin).
2. **`@terreno/api`**: `listOpenApiMiddleware` (or the shared path-building step in `api/src/openApi.ts`) adds `"x-terreno-sync": {collection, scope}` to the list operation when `options.sync` is present.

### Runtime factory (`@terreno/syncdb/react`)

```typescript
export interface CollectionHooksConfig {
  collection: string;
  /** false → 1 attempt (fail fast); number → max replay attempts; omitted → engine default (5). */
  retries?: boolean | number;
}

export type MutationTrigger<TArgs> = (args: TArgs) => {mutationId: string; id: string};

export interface CollectionHooks<TData, TCreate, TUpdate> {
  /** List query (RTK: useGet{Path}Query). */
  useListQuery: (options?: UseQueryOptions<TData>) => {data: TData[]};
  /** Single-entity read (RTK: useGet{Path}ByIdQuery). */
  useReadQuery: (id: string) => UseEntityResult<TData>;
  /** Create (RTK: usePost{Path}Mutation). */
  useCreateMutation: () => [MutationTrigger<{data: TCreate}>];
  /** Update via merge — patch semantics (RTK: usePatch{Path}ByIdMutation). */
  useUpdateMutation: () => [MutationTrigger<{id: string; data: TUpdate}>];
  /** Soft delete (RTK: useDelete{Path}ByIdMutation). */
  useDeleteMutation: () => [MutationTrigger<{id: string}>];
}

export const createCollectionHooks = <
  TData = Record<string, unknown>,
  TCreate = Record<string, unknown>,
  TUpdate = Partial<TCreate>,
>(config: CollectionHooksConfig): CollectionHooks<TData, TCreate, TUpdate> => { ... };
```

The factory returns **operation-named keys** (`useListQuery`, `useReadQuery`, `useCreateMutation`, `useUpdateMutation`, `useDeleteMutation`); the generated file renames them to friendly collection-specific names via destructuring (`useListQuery: useTodos`, `useReadQuery: useTodo`, …). Custom hooks can keep the generic factory keys or apply the same rename pattern. Each hook delegates to the existing `useQuery`/`useEntity`/`useMutate` internals (no listener logic duplicated) and threads `retries` into `client.mutate` as `maxAttempts`.

### Generated file shape

```typescript
// store/syncDbSdk.ts — GENERATED by @terreno/syncdb-codegen. Do not edit.
import {createCollectionHooks} from "@terreno/syncdb/react";

export interface Todo { _id: string; title: string; completed: boolean; ownerId: string; created: string; updated: string; }
export interface CreateTodoBody { title: string; completed?: boolean; }
export type UpdateTodoBody = Partial<CreateTodoBody>;

/** Collections with sync enabled on the backend; pass to createSyncDb. */
export const SYNC_COLLECTIONS = ["todos"] as const;

export const {
  useListQuery: useTodos,
  useReadQuery: useTodo,
  useCreateMutation: useCreateTodo,
  useUpdateMutation: useUpdateTodo,
  useDeleteMutation: useDeleteTodo,
} = createCollectionHooks<Todo, CreateTodoBody, UpdateTodoBody>({collection: "todos"});
```

Call-site comparison for migration:

```typescript
// RTK (openApiSdk)                         // syncdb (syncDbSdk — generated)
const {data} = useGetTodosQuery({});        const {data} = useTodos();
const {data} = useGetTodosByIdQuery({id});  const {data, isPending} = useTodo(id);
const [createTodo] = usePostTodosMutation(); const [createTodo] = useCreateTodo();
await createTodo({body}).unwrap();          createTodo({data}); // sync, returns {mutationId, id}
const [patchTodo] = usePatchTodosByIdMutation(); const [patchTodo] = useUpdateTodo();
const [deleteTodo] = useDeleteTodosByIdMutation(); const [deleteTodo] = useDeleteTodo();
```

`SYNC_COLLECTIONS` replaces the hand-maintained list in `example-frontend/store/syncdb.ts`, closing the "client string must match backend route" gap.

### CLI

```
terreno-syncdb-codegen --schema <url|path> --out <file> [--collections a,b] [--config <json>] [--no-format]
```

- `--schema` (required): OpenAPI URL or local JSON file (same source as `openapi-config.ts`'s `schemaFile`).
- `--out` (required): output `.ts` path.
- `--collections` (optional): comma-separated allowlist; also the fallback when the spec has no `x-terreno-sync` extensions (older backends). Errors clearly if neither extensions nor the flag identify any collection.
- `--config` (optional): JSON file with `{overrides: {todos: {retries: false}}}` per-collection settings.
- `--no-format` (optional): skip the biome/prettier formatting pass (codegen formats output via `Bun.spawn`-ed `bunx biome check --write` when available, mirroring `generate-sdk.ts`; falls back to raw emit).

## Models

No Mongoose model changes. One local-storage schema change in syncdb: the `_outbox` reserved table gains an optional `maxAttempts` numeric cell (`syncdb/src/storage/schema.ts`, `syncdb/src/mutations/outbox.ts`). Missing cell means engine default, so existing persisted stores need no migration.

## APIs

No new HTTP endpoints. One OpenAPI spec addition in `@terreno/api`: list operations of sync-enabled model routers gain

```json
"x-terreno-sync": {"collection": "todos", "scope": "owner"}
```

Vendor extensions are legal OpenAPI and ignored by the RTK codegen, Swagger UI, and the AJV validator, so this is backward-compatible.

## Notifications

None needed.

## UI

No new screens. `example-frontend/components/SyncTodosScreen.tsx` swaps its hand-rolled `SyncTodo` interface and string-based hooks for the generated `useTodos`/`useCreateTodo`/`useUpdateTodo`/`useDeleteTodo`/`useTodo`, and `store/syncdb.ts` imports `SYNC_COLLECTIONS` from the generated file. Behavior is unchanged; the existing syncdb Playwright e2e suite is the regression net.

## Phases

**Single PR** (approved). Implementation order inside the PR:

1. **syncdb runtime** — `createCollectionHooks` + `maxAttempts` plumbing (mutate → outbox → replay coordinator), with unit tests.
2. **api spec extension** — `x-terreno-sync` on list operations (+ pass `routePath` into `listOpenApiMiddleware`), with an OpenAPI generation test.
3. **codegen CLI** — `syncdb/src/codegen/`: arg parsing, spec loading, collection discovery, type emitter, file emitter, snapshot tests, `build:binary` on `@terreno/syncdb`.
4. **integration + docs** — `example-frontend` `sync-sdk` script and screen migration; README / reference / migration-guide updates. Codegen ships with existing `publish-syncdb` (no extra npm package).

## Feature Flags & Migrations

- No new feature flags. The existing `use-syncdb` flag continues to gate the syncdb path in `example-frontend`.
- No data migrations. The new `_outbox.maxAttempts` cell is optional and defaulted.
- **Publishing:** codegen is a bin of `@terreno/syncdb`; the existing `publish-syncdb` job is sufficient. Do not add a separate `@terreno/syncdb-codegen` package or publish job.

## Activity Log & User Updates

None — developer tooling only.

## Not Included / Future Work

- Per-platform prebuilt binaries as release artifacts.
- Generated wrappers for `useSyncStatus`/`useConflicts` (no per-collection typing to add).
- Server-driven filters/sorts in `useQuery` options (syncdb filters run client-side in JS; nothing for codegen to type beyond `TData`).
- Zod/AJV runtime validation of mutation payloads against the OpenAPI schema.
- Optional RTK-compatible hook naming mode (`overrides.todos.naming: "rtk"`) for teams that want import-swap migration without renames.
- RTK-compatible async mutation state (`isLoading`, promise-returning triggers with `.unwrap()`).
- A `--watch` mode.
- Generating `projects` hooks in example-frontend until a syncdb screen exists for that collection.

## Files to Create / Modify

**Create**
- `syncdb/src/codegen/cli.ts` — `#!/usr/bin/env bun` entry; arg parsing (`Bun.argv` + `util.parseArgs`), exit codes, error messages.
- `syncdb/src/codegen/loadSpec.ts` — fetch/read + JSON parse of the OpenAPI document.
- `syncdb/src/codegen/discoverCollections.ts` — walk `paths`, collect `x-terreno-sync` operations, resolve entity/create/update schema refs; apply `--collections` filter/fallback.
- `syncdb/src/codegen/emitTypes.ts` — OpenAPI schema subset → TS interfaces.
- `syncdb/src/codegen/emitSdk.ts` — assemble the output file (header, types, `SYNC_COLLECTIONS`, `createCollectionHooks` calls with overrides applied).
- `syncdb/src/codegen/*.test.ts` — unit + snapshot tests against `syncdb/src/codegen/fixtures/openapi.example.json`.
- `example-frontend/syncdb-codegen.json` — per-collection overrides example (todos with default retries).

**Modify**
- `syncdb/package.json` — `"bin": {"terreno-syncdb-codegen": "./src/codegen/cli.ts"}`, `build:binary`.
- `syncdb/src/react/collectionHooks.ts` + `syncdb/src/react/index.ts` — `createCollectionHooks` export.
- `syncdb/src/client.ts` — `MutateArgs.maxAttempts?`, pass-through to outbox.
- `syncdb/src/mutations/outbox.ts`, `syncdb/src/storage/schema.ts` — optional `maxAttempts` cell.
- `syncdb/src/sync/replayCoordinator.ts` — `row.maxAttempts ?? MAX_ERROR_NACK_ATTEMPTS` in the error-nack branch.
- `api/src/openApi.ts` (`listOpenApiMiddleware`) — emit `x-terreno-sync` when `options.sync` is set.
- `example-frontend/package.json` — `"sync-sdk"` script.
- `example-frontend/store/syncDbSdk.ts` — generated output (checked in, like `openApiSdk.ts`).
- `example-frontend/store/syncdb.ts` — import `SYNC_COLLECTIONS` from the generated file.
- `example-frontend/components/SyncTodosScreen.tsx` — use generated hooks (`useTodo`, `useCreateTodo`, `useUpdateTodo`, `useDeleteTodo`); keep `useEntityIds` for list virtualization.
- `syncdb/README.md`, `docs/how-to/migrate-rtk-to-syncdb.md`, `docs/reference/syncdb.md` — codegen sections.

## Task List

See [docs/tasks/syncdb-codegen.md](../tasks/syncdb-codegen.md).

## Acceptance Criteria

- [x] `createCollectionHooks<Todo>({collection: "todos"})` returns the five per-operation hooks (`useListQuery`, `useReadQuery`, `useCreateMutation`, `useUpdateMutation`, `useDeleteMutation`) whose behavior matches direct `useQuery`/`useEntity`/`useMutate` calls; mutation hooks return `[trigger]` tuples so RTK-style destructuring compiles (unit tests in `syncdb/src/react/`).
- [x] `createCollectionHooks({collection: "todos", retries: false})` produces mutations whose outbox rows fail terminally after a single `error` nack; `retries: 3` fails after three attempts; omitted keeps the current 5-attempt backoff (replay coordinator tests).
- [x] `GET /openapi.json` from a backend with `sync: {scope: {type: "owner"}}` on `/todos` includes `x-terreno-sync: {collection: "todos", scope: "owner"}` on the list operation; non-synced routes have no extension (api test).
- [x] `terreno-syncdb-codegen --schema <fixture> --out out.ts` emits a file that type-checks under the example-frontend tsconfig and contains `SYNC_COLLECTIONS`, typed interfaces, and per synced collection the five friendly hooks (`useTodos`, `useTodo`, `useCreateTodo`, `useUpdateTodo`, `useDeleteTodo` for the todos fixture — snapshot test).
- [x] `--collections todos` filters output to that collection; a spec without extensions and no `--collections` flag exits non-zero with an actionable message.
- [x] A config file with `{overrides: {todos: {retries: false}}}` produces `createCollectionHooks<...>({collection: "todos", retries: false})` in the output.
- [x] `bun run build:binary` in `syncdb/` produces a standalone executable that generates identical output to the bin entry.
- [ ] `bun run sync-sdk` in `example-frontend` (backend running) regenerates `store/syncDbSdk.ts` with no diff when the backend is unchanged; SyncTodosScreen works against the generated hooks (existing syncdb e2e suite passes).
- [x] `bun run lint` (syncdb, example-frontend), `bun test` in `syncdb/` (500 pass), and `api/src/openApi.test.ts` (26 pass).
- [x] No separate `@terreno/syncdb-codegen` package or `publish-syncdb-codegen` job; the CLI ships with `@terreno/syncdb`.
