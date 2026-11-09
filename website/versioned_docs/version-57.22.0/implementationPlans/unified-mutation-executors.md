# Unified mutation executors (MCP → executors)

**Status:** Complete — 2026-08-25  
**Branch:** `cursor/architecture-ips-a7ec`  
**Owner:** —  
**Created:** 2026-08-24  
**Architecture source:** [model-router-actions.md](../explanation/model-router-actions.md), [model-router-mcp.md](model-router-mcp.md), [pluggable-database-sqlite.md](pluggable-database-sqlite.md)  
**Task list:** [unified-mutation-executors.md](../tasks/unified-mutation-executors.md)  
**Depends on:** none  
**Unlocks:** [can-as-permission-seam.md](can-as-permission-seam.md), [collection-registry.md](collection-registry.md)

## Goal

One write pipeline for create, update, and delete. REST and Sync already call `executeCreate` / `executeUpdate` / `executeDelete` in `api/src/sync/executors.ts`. MCP `handleCreate` / `handleUpdate` / `handleDelete` in `api/src/mcp/handlers.ts` still run permissions, transformers, hooks, and `model.create` / `doc.save` themselves.

When this ships, MCP write tools call those executors. A permission, hook, field-view, or soft-delete fix lands once.

## Non-Goals

- List/read unification (MCP list/read stay handlers; they are not duplicated against executors).
- Replacing executors with a new `WriteService` class.
- Implementing the SQLite `DatabaseAdapter` (executors will later call the adapter; this IP does not introduce it). See [pluggable-database-sqlite.md](pluggable-database-sqlite.md).
- Changing MCP tool names, JSON-RPC transport, or `excludeFields` config shape.
- Compiling RBAC `access` away from `PermissionMethod[]` (that is [can-as-permission-seam.md](can-as-permission-seam.md)).

## Decisions

| Question | Decision |
|----------|----------|
| Interface shape | **A — MCP adapters call existing executors.** Not B (a new `WriteService` wrapping both). Smallest interface: three functions already used by REST and Sync. |
| Error contract | Executors keep throwing `APIError`. MCP maps `APIError` (and hook failures) onto the existing MCP error `textResult` / `errorResult` envelope. No new error type. |
| Request object | Pass a real Express `req` when HTTP; otherwise the existing executor `{user}` stub via `createMCPRequest` fields (`user`, `body`). Do not invent a second hook request type. |
| MCP-only behavior | Keep MCP `excludeFields`, `mcpResponseHandler`, and tool-result JSON wrapping in the handler **after** the executor returns `{doc}`. Executors stay transport-agnostic. |
| `skipPostHooks` | MCP uses the REST path (`skipPostHooks` unset). Sync keeps the ledger-safe skip. |
| Compatibility | No app-facing API break. MCP tool argument schemas and success JSON `{data}` stay the same. Error **strings** may align to `APIError.title` where they currently diverge; tests that pin MCP wording update in this slice. |
| Sequencing | Land before collection-registry and can-as-permission-seam so those IPs do not have to touch two write implementations. |

## Interface shapes considered

**A (chosen).** `handleCreate(entry, args, user)` → `executeCreate({model, options: entry.options, user, body, req: mcpStubReq})` → map `{doc}` / `APIError` to `MCPToolResult`.

**B (rejected).** `class MutationService { create; update; delete }` that REST, Sync, and MCP all call. Deletes the executor module only by renaming it; REST already has the deep module.

## Architecture

```
Before:
  MCP handlers ──duplicate──► Mongoose + permissions + hooks
  REST / Sync ──────────────► executors ──► Mongoose

After:
  MCP ──map args/errors──► executors ◄── REST / Sync
                              │
                              ▼
                           Mongoose (later: DatabaseAdapter)
```

`executeCreate` already: `checkPermissions` → `transform` → `preCreate` → `model.create` → populate → `postCreate` (unless skipped). MCP `handleCreate` repeats that and calls `model.create` directly (`api/src/mcp/handlers.ts`).

Handler leftover after this IP:

1. Auth / anonymous gate that is MCP-transport specific.
2. `omitDeniedWriteFields` / MCP `excludeFields` (if not already covered by executor field views — prove with tests; if executor already strips write-denied fields, delete the MCP copy).
3. Call executor.
4. `mcpResponseHandler` / `serializeResponse`.
5. `APIError` → MCP error result.

## Docs in this slice

| Page | Change |
|------|--------|
| `docs/explanation/model-router-actions.md` | Writes (CRUD, not named actions) go through executors for REST, Sync, and MCP. |
| `docs/reference/api.md` (MCP tools) | MCP create/update/delete share REST permission and hook semantics; errors are `APIError` titles. |
| `docs/implementationPlans/model-router-mcp.md` | Note: write path now executors (status note, not a rewrite of that shipped IP). |

Skip operator how-to: no new env, CLI, or app setup.

## Testing

Public seam: `executeCreate` / `executeUpdate` / `executeDelete` (existing `executors.test.ts`) plus MCP integration tests that assert **behavior** (denied create, preCreate null, hook throw, field omit) against the same fixtures as REST.

Add one MCP test that fails if `handleCreate` uses `model.create` instead of `executeCreate` (spy or shared side-effect: `preCreate` called once with the stub request).

Do not weaken executor tests. MCP tests that duplicate permission matrices can shrink after the adapter is thin.

## Risks

| Risk | Mitigation |
|------|------------|
| MCP error strings differ from `APIError.title` | Golden-file or explicit map in handler; update MCP tests in-slice. |
| `createMCPRequest` missing Express fields hooks read | Inventory hook usage in `api` tests and example-backend; extend stub only for fields executors already pass on HTTP. |
| Double field-stripping | Single test: write-denied field absent from DB for both REST and MCP. |

## Phases

1. Map MCP create to `executeCreate`; MCP create tests green and share preCreate/permission behavior with REST.
2. Map update and delete the same way.
3. Delete duplicated MCP write bodies; keep transport mapping. Docs + changelog fragment.

## Feature Flags & Migrations

None. Internal call-graph change.

## Not Included / Future Work

- Executor calls `DatabaseAdapter` ([pluggable-database-sqlite.md](pluggable-database-sqlite.md)).
- MCP list/read through a shared query executor.
- `access.can()` as the permission engine ([can-as-permission-seam.md](can-as-permission-seam.md)).

## Files to Create / Modify

- `api/src/mcp/handlers.ts` — write handlers become adapters
- `api/src/mcp/handlers.ts` tests / `api/src/mcp/integration.test.ts`
- `api/src/sync/executors.ts` — only if a missing hook/request field is required for MCP parity; prefer not
- Docs listed above
- Changelog fragment for `@terreno/api`

## Acceptance Criteria

- [ ] MCP create/update/delete call `executeCreate` / `executeUpdate` / `executeDelete`.
- [ ] MCP write handlers contain no `model.create` / `doc.save` / delete persistence.
- [ ] A `preCreate` / `preUpdate` / `preDelete` hook runs for MCP the same as REST (existing hook tests or new shared cases).
- [ ] Permission denial for MCP writes matches executor denial (status/title mapped into MCP error result).
- [ ] `bun test` in `api` covering `mcp/` and `sync/executors` passes.
- [ ] Docs in this slice match the shipped call graph.

## Task List

[docs/tasks/unified-mutation-executors.md](../tasks/unified-mutation-executors.md)
