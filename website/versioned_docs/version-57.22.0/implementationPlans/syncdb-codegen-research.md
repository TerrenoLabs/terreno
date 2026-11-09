# Research: @terreno/syncdb-codegen

**Date:** 2026-08-20  
**Scope:** Validate the draft IP (`docs/implementationPlans/syncdb-codegen.md`) against the current `master` codebase and parent syncdb work.  
**Status:** Complete — clarification pass answered 2026-08-20. IP **Approved**.

## Clarification outcomes (2026-08-20)

| # | Topic | Choice |
|---|-------|--------|
| 1 | Collection discovery | A — `x-terreno-sync` + `--collections` fallback |
| 2 | Per-mutation retries | A — `maxAttempts` plumbing |
| 3 | Type emission | A — hand-rolled emitter |
| 4 | Hook factory | A — `createCollectionHooks` in `@terreno/syncdb/react` |
| 5 | Hook naming | **C — friendly names** (`useTodos`, `useTodo`, `useCreateTodo`, …) |
| 6 | Mutation return | A — `[trigger]` one-tuple |
| 7 | example-frontend scope | A — todos only |
| 8 | Delivery | **B — single PR** |
| 9 | npm publish | **Include `@terreno/syncdb-codegen` in `publish-on-tag.yml`** |

## Open questions (blocking — see blend Step 3)

Resolved — see table above.

## Problem summary

`@terreno/syncdb` is implemented (Phases 1–8 of `syncdb-local-first.md` landed). Consumers still hand-write collection strings, entity interfaces, and hook wiring — see `example-frontend/components/SyncTodosScreen.tsx`. RTK consumers get typed hooks from `bun run sdk` → `openApiSdk.ts`. The gap is a **codegen CLI** that reads the same OpenAPI spec and emits typed syncdb hooks (friendly names per approved IP).

## What was investigated

| Area | Locations | Finding |
|------|-----------|---------|
| React hooks | `syncdb/src/react/hooks.ts`, `index.ts` | `useQuery`, `useEntity`, `useMutate` exist; no per-operation hooks, no `createCollectionHooks` |
| Mutate / outbox | `syncdb/src/client.ts`, `mutations/outbox.ts`, `storage/schema.ts` | `MutateArgs` has no `maxAttempts`; outbox rows have `errorNackCount` only; replay uses global `MAX_ERROR_NACK_ATTEMPTS = 5` |
| OpenAPI list | `api/src/openApi.ts` `listOpenApiMiddleware` | No vendor extensions; no `operationId`; tags = model collection name |
| Sync registry | `api/src/sync/registry.ts`, `api/src/api.ts` | In-memory only; `collectionTag = routePath.replace(/^\//, "")`; not reflected in OpenAPI |
| Example backend | `example-backend/src/api/todos.ts`, `projects.ts` | `sync: {scope: {type: "owner"}}` on todos; tenant scope on projects |
| RTK hook names | `example-frontend/store/openApiSdk.ts` | `useGetTodosQuery`, `useGetTodosByIdQuery`, `usePostTodosMutation`, `usePatchTodosByIdMutation`, `useDeleteTodosByIdMutation` |
| Codegen package | `syncdb-codegen/` | **Does not exist** — tasks/IP only |
| Parent IP | `docs/implementationPlans/syncdb-local-first.md` | Shaped; codegen listed as Phase 6 / future work |
| Roadmap | `.github/roadmap-fields.yml` present | Roadmap-enabled repo; no GitHub issue found for syncdb-codegen |

## Current consumer pattern (manual)

```typescript
// example-frontend/components/SyncTodosScreen.tsx
interface SyncTodo { _id: string; title?: string; completed?: boolean; created?: string; }
const todos = useQuery<SyncTodo>("todos", {sort: sortByCreatedDesc});
const {update, remove} = useMutate("todos");
```

`example-frontend/store/syncdb.ts` maintains `SYNC_COLLECTIONS` by hand — can drift from backend `sync` registration.

## Candidate options (not chosen here — see blocking questions)

### How codegen discovers synced collections

| Option | Pros | Cons |
|--------|------|------|
| **A. `x-terreno-sync` on list OpenAPI ops** | Single input (same as RTK); spec is versioned with backend; ~10-line api change | Must thread `routePath` into `listOpenApiMiddleware` (not available today) |
| **B. `--collections` CLI flag only** | No api change | Drifts from backend; duplicates config |
| **C. `GET /sync/config` manifest** | Runtime truth | Extra endpoint; second source of truth vs OpenAPI |

Draft IP recommends **A + B fallback**.

### Per-mutation retry budget (`retries` / `maxAttempts`)

| Option | Pros | Cons |
|--------|------|------|
| **A. Plumb `maxAttempts` through mutate → outbox → replay** | Config is honest; matches RTK `maxRetries: 0` intent | Touches syncdb storage + replay coordinator |
| **B. Codegen emits `retries` but engine ignores** | Smaller diff | Lying generated config |

Draft IP recommends **A**.

### Type emission from OpenAPI schemas

| Option | Pros | Cons |
|--------|------|------|
| **A. Hand-rolled emitter for mongoose-to-swagger dialect** | Zero runtime deps; small compiled binary | Must grow if spec dialect widens |
| **B. `openapi-typescript` or oazapfts** | Battle-tested | Heavier dep; may emit more than needed |

Draft IP recommends **A** (~150 lines + snapshot tests).

### Hook factory location

| Option | Pros | Cons |
|--------|------|------|
| **A. `createCollectionHooks` in `@terreno/syncdb/react`** | Versioned with hooks; custom hooks use same factory | Expands syncdb public API |
| **B. Inline factory in every generated file** | No syncdb API change | Duplicated generated code |
| **C. Runtime export from `@terreno/syncdb-codegen`** | — | Codegen becomes app dependency (rejected) |

Draft IP recommends **A**.

### Hook naming and RTK collision

| Option | Pros | Cons |
|--------|------|------|
| **A. Grouped `useTodosMutate()`** | No name collision with RTK | Different call sites; harder migration |
| **B. RTK-exact per-op names (`useGetTodosQuery`, …)** | Import-path migration | Intentional name collision — must not barrel-export both SDKs |
| **C. Friendly names (`useCreateTodo`)** | Readable | Diverges from RTK; migration friction |

Draft IP recommends **B**.

### Mutation hook return shape

| Option | Pros | Cons |
|--------|------|------|
| **A. `[trigger]` one-tuple** | RTK destructuring compiles; syncdb writes are sync | `.unwrap()` / `isLoading` must be deleted at migration |
| **B. Full RTK async tuple** | Drop-in compat | Fakes async state syncdb does not have |

Draft IP recommends **A**.

## Technical notes for implementation

1. **`listOpenApiMiddleware` needs `routePath`**: Today signature is `(model, options)` only. `collection` for `x-terreno-sync` must match `sync/registry.ts` `collectionTag` (path without leading `/`). Pass path from `_buildModelRouter` or read from options if added there.

2. **`scope` in extension**: Emit scope **type** string (`owner` | `tenant` | `broadcast` | `custom`). Function resolvers → `"custom"`.

3. **Name derivation**: Match `@rtk-query/codegen-openapi` — pascal-case from HTTP method + path segments (verified against `openApiSdk.ts` for `/todos`).

4. **example-backend has two synced models** (todos owner, projects tenant). Draft IP example-frontend integration only wires todos — confirm whether projects should appear in generated SDK for the example app.

5. **No data migration** for optional `_outbox.maxAttempts` cell — missing cell keeps engine default (5).

6. **Roadmap handoff**: When IP status → Approved, run `roadmap-item` to create/update tracking issue (no existing issue found).

## Open questions (blocking — see blend Step 3)

Transferred to the clarification pass in the blend thread; do not treat draft IP decisions as approved until answered.

## References

- `docs/implementationPlans/syncdb-codegen.md` (draft IP)
- `docs/tasks/syncdb-codegen.md` (task breakdown)
- `docs/implementationPlans/syncdb-local-first.md` (parent — Phase 6 codegen)
- `docs/how-to/migrate-rtk-to-syncdb.md` (migration guide — codegen section TBD)
- `.rulesync/skills/generate-sdk/SKILL.md` (RTK codegen parallel)
