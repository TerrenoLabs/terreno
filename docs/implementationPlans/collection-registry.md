# One collection registry

**Status:** Complete  
**Branch:** `cursor/architecture-ips-a7ec`  
**Owner:** —  
**Created:** 2026-08-24  
**Architecture source:** [modular-api-design.md](../explanation/modular-api-design.md), [model-router-mcp.md](model-router-mcp.md), [admin-improvements.md](admin-improvements.md)  
**Task list:** [collection-registry.md](../tasks/collection-registry.md)  
**Depends on:** [unified-mutation-executors.md](unified-mutation-executors.md) (soft — writes already one pipeline; registry does not need to wait on MCP adapters, but avoid teaching two write paths)  
**Unlocks:** simpler RBAC option injection; [describe-model-schema.md](describe-model-schema.md) can hang metadata on the descriptor

## Goal

Register a modelRouter collection once. MCP, realtime, and Sync stop each owning a process-global array plus `update*RegistryOptions` after TerrenoApp injects `accessControl`.

`modelRouter` today (`api/src/api.ts`): `registerMCPModel` / `registerRealtime` / `registerSync` at call time, then `updateMCPRegistryOptions` / `updateRealtimeRegistryOptions` / `updateSyncRegistryOptions` in `_buildModelRouter` when options are enriched. RBAC and MCP work keep touching all three.

## Non-Goals

- A fourth parallel registry.
- Redesigning MCP tool JSON, Socket.IO payloads, or the Sync protocol.
- Merging admin’s `AdminApp` model list into this registry in v1 (admin still has its own config; a later task may read the descriptor).
- Replacing `ModelRouterOptions` with a new public options type in one PR (options bag can stay; the **runtime catalog** is what unifies).
- Splitting TerrenoApp into Options/Middleware/Hooks files ([ModularAPI.md](ModularAPI.md) file-split is explicitly not this IP).

## Decisions

| Question | Decision |
|----------|----------|
| Interface shape | **A — `CollectionRegistry` keyed by route path**, holding `{path, model, options, surfaces}`. Surfaces keep **read helpers** (`getMCPRegistry()`, `findRealtimeByCollectionName()`, …) as views. Not B (event bus / subscribe API) — one extra indirection, same data. |
| Identity | Primary key: `routePath` (e.g. `/todos`). MCP’s `modelName` index is a secondary lookup that must not diverge. |
| Option patch | `replaceCollectionOptions(routePath, options)` updates the single record. Surface `update*RegistryOptions` become one-line wrappers or are deleted in the contract phase. |
| Custom MCP tools | Stay on a **separate** `mcpCustomTools` list. They are not collections. |
| Sync-only validation | `registerSync` schema checks (`deleted`, `_syncSeq`, scope fields) and index tracking stay in `api/src/sync/registry.ts` **functions** called from `CollectionRegistry.register` when `options.sync` is set. Do not lose those guards. |
| Compatibility | Public exports `registerMCPModel`, `registerRealtime`, `registerSync`, `clear*Registry` remain until the contract phase, implemented as wrappers. Tests migrate to `clearCollectionRegistry()`; wrappers keep calling it. |
| Tests | One registry clear in test setup; existing MCP/realtime/sync tests keep working through wrappers in Phase 1. |

## Interface shapes considered

**A (chosen).**

```typescript
interface CollectionRecord<T = unknown> {
  routePath: string;
  model: Model<T>;
  options: ModelRouterOptions<T>;
  surfaces: {mcp: boolean; realtime: boolean; sync: boolean};
}

registerCollection({routePath, model, options}): void
replaceCollectionOptions(routePath, options): void
getCollection(routePath): CollectionRecord | undefined
listCollections(): CollectionRecord[]
```

**B (rejected).** Surfaces subscribe `onCollection(record)`. Requires teardown, ordering, and still stores the same records.

## Architecture

```
Before:
  modelRouter → registerMCP + registerRealtime + registerSync
             → later updateMCP* + updateRealtime* + updateSync*

After:
  modelRouter → CollectionRegistry.register(descriptor)
  TerrenoApp.build → CollectionRegistry.replaceOptions(path, enriched)
  MCP / realtime / sync read views of the same records
```

`api/src/mcp/registry.ts` (~70 lines) and `api/src/realtime/registry.ts` (~78 lines) are nearly the same array + update-by-key. `api/src/sync/registry.ts` adds contract validation and index promises — keep that logic, not the duplicated options pointer.

## Docs in this slice

| Page | Change |
|------|--------|
| `docs/explanation/modular-api-design.md` | Collection catalog is the runtime seam for surfaces. |
| `docs/reference/api.md` | `modelRouter` registers one collection; MCP/realtime/sync flags attach surfaces. |
| MCP / realtime / sync reference sections | Registration is not a separate app-facing API. |

## Testing

Seam: `registerCollection` + `replaceCollectionOptions`. Tests:

- Register with `mcp` + `sync`; `getMCPRegistry()` and sync lookup see the same `options` object identity after replace.
- `replaceCollectionOptions` on unknown path is a no-op (current update* behavior).
- Sync still throws on missing `deleted` / `_syncSeq` at register time.
- Existing realtime/MCP/sync integration tests pass without behavior change.

## Risks

| Risk | Mitigation |
|------|------------|
| Startup order / TerrenoApp.build | Keep register-then-replace; do not require all modelRouters to be three-arg form beyond today’s warnings. |
| Test isolation | `clearCollectionRegistry()` clears all surfaces; wrappers’ `clearMCPRegistry` etc. call it **or** clear only that view — **Decision: clear all** so tests cannot leave a stale MCP entry after a sync-only clear. Update tests that assumed independent clears. |
| Export churn | Wrappers stay through one minor release; changelog lists wrappers as deprecated internals if they were public. |

## Phases

1. Add `CollectionRegistry`; `modelRouter` writes it **and** still calls existing register functions (dual-write). Tests prove options identity after replace on the new registry.
2. Point MCP/realtime/sync lookups at the registry; delete duplicate arrays. Keep wrapper function names.
3. Delete dual-write; `update*RegistryOptions` become wrappers. Docs + changelog.

## Feature Flags & Migrations

No runtime flag. Dual-write in Phase 1 is the migration.

## Not Included / Future Work

- Admin `models[]` reading `CollectionRegistry`.
- Per-app registry instance (today is process-global, matching current registries). A TerrenoApp-scoped map is a later seam if two apps share a process.

## Files to Create / Modify

- `api/src/collectionRegistry.ts` (new)
- `api/src/api.ts` — register/replace
- `api/src/mcp/registry.ts`, `api/src/realtime/registry.ts`, `api/src/sync/registry.ts` — views + sync validation
- Tests that `clearMCPRegistry` / `clearRealtimeRegistry` / `clearSyncRegistry`
- `api/src/index.ts` exports if any new public names
- Docs listed above

## Acceptance Criteria

- [ ] One in-memory catalog holds collection options for MCP, realtime, and sync.
- [ ] TerrenoApp option enrichment updates that catalog once per path.
- [ ] Sync schema/index guards still fail fast at startup.
- [ ] Independent `clearMCPRegistry()` in a test cannot leave realtime entries pointing at old options (documented clear-all behavior, tests updated).
- [ ] No behavior change to MCP tools, socket events, or sync protocol.
- [ ] Docs describe the catalog; `bun test` for api mcp/realtime/sync registries passes.

## Task List

[docs/tasks/collection-registry.md](../tasks/collection-registry.md)
