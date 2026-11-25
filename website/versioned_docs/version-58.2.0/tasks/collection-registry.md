# Tasks: One collection registry

IP: [collection-registry.md](../implementationPlans/collection-registry.md)

## Phase 1 — Dual-write catalog

- [x] **Task 1.1**: `CollectionRegistry` module
  - Delivers: `registerCollection`, `replaceCollectionOptions`, `getCollection`, `listCollections`, `clearCollectionRegistry` with unit tests (unknown path no-op, options replace)
  - Files: `api/src/collectionRegistry.ts`, `api/src/collectionRegistry.test.ts`
  - Blocked by: none
  - Acceptance: bun tests for the module pass without wiring modelRouter
- [x] **Task 1.2**: Dual-write from `modelRouter`
  - Delivers: `modelRouter` / `_buildModelRouter` write the catalog in addition to existing `register*` / `update*`
  - Files: `api/src/api.ts`
  - Blocked by: 1.1
  - Acceptance: existing api tests still pass

## Phase 2 — Surfaces read the catalog

- [x] **Task 2.1**: MCP and realtime views
  - Delivers: `getMCPRegistry` / realtime finders read `CollectionRegistry`; arrays in those files removed
  - Files: `api/src/mcp/registry.ts`, `api/src/realtime/registry.ts`, related tests
  - Blocked by: 1.2
  - Acceptance: MCP and realtime tests pass; `updateMCPRegistryOptions` updates the shared record
- [x] **Task 2.2**: Sync view + keep validation
  - Delivers: sync lookup uses catalog; `registerSync` validation + index promises still run
  - Files: `api/src/sync/registry.ts`, `api/src/sync/*.test.ts`
  - Blocked by: 1.2
  - Acceptance: missing `deleted` / `_syncSeq` still throws; sync tests pass

## Phase 3 — Contract

- [x] **Task 3.1**: Single writer + clear-all
  - Delivers: `modelRouter` only writes `CollectionRegistry`; wrapper register/update/clear functions; tests that used independent clears updated
  - Files: `api/src/api.ts`, registry wrappers, tests
  - Blocked by: 2.1, 2.2
  - Acceptance: one `replaceCollectionOptions` is enough for MCP+sync options identity
- [x] **Task 3.2**: Docs + changelog
  - Files: `docs/explanation/modular-api-design.md`, `docs/reference/api.md`, changelog
  - Blocked by: 3.1
  - Skills: `update-docs`
  - Acceptance: docs name the catalog as the runtime seam
