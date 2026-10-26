# Tasks: MCP service tokens

Plan: [`docs/implementationPlans/mcp-service-tokens.md`](../implementationPlans/mcp-service-tokens.md)

**Status:** Approved — all in-scope tasks Roast PASS. **next: brew**.

## Instructions for the implementing agent

- Load `terreno-backend-api`, `mongoose-schema-safety`, `backend-test-env`, `update-docs`.
- Phase 4+: `verify-ui-changes`, `building-admin-interfaces`, `generate-sdk`.
- TDD: failing test first per task.
- Run `bun test` in touched packages; `bun run lint` on `api/`, `example-backend/`, `example-frontend/` as applicable.
- Never log or persist full `mcp_` tokens after the create response.
- Do not implement OAuth, scopes, or REST bearer for service tokens.

---

### Phase 1: Model and MCP auth

- [x] **Task 1.1**: `McpServiceToken` model + types
  - Delivers: Mongoose model with issue/verify/revoke/count statics; SHA-256 hash; `mcp_` + 32-byte hex secret; field descriptions on every path
  - Files: `api/src/models/mcpServiceToken.ts`, `api/src/types/mcpServiceToken.ts`, `api/src/models/mcpServiceToken.test.ts`, `api/src/index.ts`
  - Blocked by: none
  - Docs: `docs/reference/api.md` (exported model contract)
  - Skills: `mongoose-schema-safety`, `terreno-backend-api`
  - Acceptance: `issueFor` returns plaintext once; `verify` finds active token; respects `revokedAt` and `expiresAt`; `countActiveForUser` correct; duplicate hash impossible

- [x] **Task 1.2**: Service token branch in `extractUserFromHeaders`
  - Delivers: when `mcpServiceTokens` enabled and bearer starts with `mcp_`, resolve user via model verify; update `lastUsedAt`; order before Better Auth and JWT
  - Files: `api/src/mcp/auth.ts`, `api/src/mcp/auth.test.ts`, `api/src/mcp/types.ts` (extend `MCPAuthContext` if needed)
  - Blocked by: Task 1.1
  - Docs: none
  - Skills: `terreno-backend-api`, `backend-test-env`
  - Acceptance: valid token resolves owner; revoked/expired/disabled user → undefined; non-`mcp_` bearer still uses existing JWT/session tests unchanged

---

### Phase 2: Self-serve routes and TerrenoApp flag

- [x] **Task 2.1**: `/mcp/service-tokens` HTTP routes
  - Delivers: POST create (cap 10), GET list (owner), DELETE revoke (owner); OpenAPI via `createOpenApiBuilder`; reject `mcp_` bearer on these routes
  - Files: `api/src/mcp/serviceTokens.ts`, `api/src/mcp/serviceTokens.test.ts`, `api/src/index.ts`
  - Blocked by: Task 1.1
  - Docs: `docs/reference/api.md` (route table)
  - Skills: `terreno-backend-api`, `update-docs`
  - Acceptance: supertest covers happy path, cap, owner isolation, create response includes `mcpUrl` + one-time `token`; list omits hash and plaintext

- [x] **Task 2.2**: `TerrenoAppOptions.mcpServiceTokens`
  - Delivers: `{enabled, publicMcpUrl?}` or boolean shorthand; mounts routes when enabled; passes flag into `MCPAuthContext`
  - Files: `api/src/terrenoApp.ts`, `api/src/terrenoApp.test.ts` (or service token integration test)
  - Blocked by: Task 1.2, Task 2.1
  - Docs: `docs/reference/api.md` (`TerrenoAppOptions`); `docs/how-to/connect-mcp-service-token.md` (create skeleton)
  - Skills: `terreno-backend-api`, `update-docs`
  - Acceptance: app with flag on serves routes and accepts `mcp_` on `/mcp`; flag off serves neither

- [x] **Task 2.3**: End-to-end MCP call with service token
  - Delivers: integration test — mint token, `POST /mcp` JSON-RPC `tools/call` with Bearer, assert the same owner-visible result as a session JWT
  - Files: extend `api/src/mcp/server.test.ts` or `serviceTokens.test.ts`
  - Blocked by: Task 2.2
  - Docs: `docs/how-to/connect-mcp-service-token.md` (GET 405 probe + POST `initialize` / `tools/call`)
  - Skills: `terreno-backend-api`, `update-docs`
  - Acceptance: GET `/mcp` returns Streamable-HTTP JSON-RPC 405; POST `tools/call` with `mcp_` acts as the owner; invalid `mcp_` is denied

---

### Phase 3: Example-backend admin

- [x] **Task 3.1**: Enable flag + admin model registration
  - Delivers: `mcpServiceTokens: {enabled: true, publicMcpUrl: …}` on example `TerrenoApp`; `AdminApp` model entry — listFields, create/update disabled, admin delete → revoke; `responseHandler` strips `tokenHash`
  - Files: `example-backend/src/server.ts`, `example-backend/src/api/mcpServiceTokensAdmin.ts` (if preDelete hook extracted), `example-backend/src/tests/mcpServiceTokens.admin.test.ts`
  - Blocked by: Task 2.2
  - Docs: `example-backend/README.md` (one paragraph + admin path)
  - Skills: `building-admin-interfaces`, `terreno-backend-api`, `update-docs`
  - Acceptance: admin user lists tokens for multiple users; revoke removes MCP access; non-admin cannot hit admin routes

---

### Phase 4: Example-frontend settings UI

- [x] **Task 4.1**: SDK codegen for service-token routes
  - Delivers: regenerated `openApiSdk` hooks for POST/GET/DELETE `/mcp/service-tokens`
  - Files: `example-frontend/store/openApiSdk.ts` (generated), `example-frontend/openapi-config.ts` (only if path filter needed)
  - Blocked by: Task 2.1
  - Skills: `generate-sdk`
  - Acceptance: TypeScript compiles; hooks callable from settings screen

- [x] **Task 4.2**: `/settings/mcp` screen
  - Delivers: create form (name, optional expiry), copy-once modal (URL + token + JSON snippet), list with revoke, link from Profile
  - Files: `example-frontend/app/settings/_layout.tsx`, `example-frontend/app/settings/mcp.tsx`, `example-frontend/app/(tabs)/profile.tsx`
  - Blocked by: Task 4.1
  - Docs: none (how-to covers operator steps)
  - Skills: `terreno-ui`, `verify-ui-changes`
  - Acceptance: manual test — create, copy snippet, revoke; artifacts in `/opt/cursor/artifacts/`; web on port 8082

---

### Phase 5: Documentation

- [x] **Task 5.1**: Operator docs + cross-links
  - Delivers: complete `docs/how-to/connect-mcp-service-token.md` (Perplexity form table, JSON snippet, curl); update `docs/how-to/expose-mcp-tools.md` auth section; `docs/explanation/authentication.md` short subsection; note sibling OAuth in `app-mcp-server.md` cross-link only
  - Files: docs listed above
  - Blocked by: Task 2.3, Task 4.2
  - Docs: same files
  - Skills: `update-docs`
  - Acceptance: stranger can connect Perplexity from docs alone; `bun run website:build` passes if pages are wired in sidebar

---

## Frontier

Completed: 1.1, 1.2, 2.1, 2.2, 2.3, 3.1, 4.1, 4.2, 5.1. Frontier: none. **next: brew**.

```
1.1 → 1.2 → 2.2 → 2.3
1.1 → 2.1 → 2.2
2.1 → 4.1 → 4.2
2.2 → 3.1
2.3 + 4.2 → 5.1
```

## Acceptance → verification map

| IP criterion | Task(s) |
| --- | --- |
| Flag off behavior | 2.2 |
| Create once / list safe | 2.1 |
| Cap 10 | 2.1 |
| Expiry + revoke on `/mcp` | 1.2, 2.3 |
| Admin all-users revoke | 3.1 |
| Perplexity GET+POST | 2.3 |
| Settings UI | 4.2 |
| Docs | 5.1 |
