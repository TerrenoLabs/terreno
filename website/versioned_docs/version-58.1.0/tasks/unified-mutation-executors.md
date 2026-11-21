# Tasks: Unified mutation executors

IP: [unified-mutation-executors.md](../implementationPlans/unified-mutation-executors.md)

## Phase 1 — MCP create → `executeCreate`

- [x] **Task 1.1**: MCP create uses `executeCreate`
  - Delivers: `handleCreate` calls `executeCreate`; `model.create` gone from create path; MCP error mapping for `APIError`
  - Files: `api/src/mcp/handlers.ts`, `api/src/mcp/integration.test.ts`, `api/src/sync/executors.test.ts` (only if a shared hook case is missing)
  - Blocked by: none
  - Docs: none yet (behavior still MCP-only on create)
  - Skills: `backend-test-env` if tests touch `process.env`; `update-docs` not required until Phase 3
  - Acceptance: existing MCP `handleCreate` tests pass; one test proves `preCreate` runs for MCP create; `rg "model.create" api/src/mcp/handlers.ts` is empty on the create path

## Phase 2 — Update and delete

- [x] **Task 2.1**: MCP update uses `executeUpdate`
  - Delivers: `handleUpdate` adapter only
  - Files: `api/src/mcp/handlers.ts`, `api/src/mcp/integration.test.ts`
  - Blocked by: 1.1
  - Acceptance: MCP update tests pass; no `doc.save()` in `handleUpdate`
- [x] **Task 2.2**: MCP delete uses `executeDelete`
  - Delivers: `handleDelete` adapter only (soft-delete semantics from executor)
  - Files: `api/src/mcp/handlers.ts`, `api/src/mcp/integration.test.ts`
  - Blocked by: 1.1
  - Acceptance: MCP delete tests pass; persistence only inside executor

## Phase 3 — Contract and docs

- [x] **Task 3.1**: Docs + changelog
  - Delivers: explanation/reference match the single write pipeline
  - Files: `docs/explanation/model-router-actions.md`, `docs/reference/api.md`, `docs/implementationPlans/model-router-mcp.md` (pointer), changelog fragment
  - Blocked by: 2.1, 2.2
  - Skills: `update-docs`
  - Acceptance: a stranger can find “MCP writes use executors” from docs without reading the PR
