# Implementation Plan: MCP service tokens

**Status:** Complete — shipped in #1263  
**Roadmap:** Area=`mcp`, Target=`Released`, Impact=`Feature`  
**Branch:** TBD  
**Owner:** unassigned  
**Created:** 2026-09-03  
**Depends on:** [model-router-mcp.md](model-router-mcp.md) (shipped — `POST /mcp` + `extractUserFromHeaders`)  
**Sibling:** [app-mcp-server.md](app-mcp-server.md) (OAuth 2.1 for interactive MCP clients — complementary, not a blocker)

## Goal

Authenticated users mint **personal MCP service tokens** that act as that user on the
consumer app's `POST /mcp` endpoint only. They copy an **MCP URL** plus a **Bearer
`mcp_…` key** into external clients (Perplexity custom connectors, Claude Code, Cursor,
Inspector) without pasting a session JWT. Admins list and revoke any user's tokens from
the admin panel.

When this is done, an operator can:

1. Set `mcpServiceTokens: true` on `TerrenoApp`.
2. Sign in to the example app, open **Settings → MCP**, create a named token, copy URL +
   key once.
3. Paste into Perplexity (**Custom connector → Remote → Streamable HTTP → API Key**).
4. Call `tools/list` on `/mcp` with `Authorization: Bearer mcp_…` and see the same tools
   that user would see over REST-backed MCP.
5. Revoke from the settings screen or from **Admin → MCP service tokens**.

## Non-Goals

| Out | Why |
| --- | --- |
| Hosted `@terreno/mcp` (dev-time codegen server) | Different product surface |
| `@terreno/infra-mcp` machine tokens | Separate IP; GCP/Sentry scope |
| OAuth 2.1 / RFC 9728 for MCP | [app-mcp-server.md](app-mcp-server.md) Phase 6; tokens are the static-key path for Perplexity |
| Per-token scopes (read-only, tool allowlists) | v1 is full user MCP permissions |
| Token auth on REST, sync sockets, or admin HTTP | MCP-only credential (Q4) |
| Secret in query string or connection URL | Header-only Bearer (Q3) |
| Password re-prompt on mint | Session/JWT is enough for create/list/revoke |
| Per-token rate limits | Existing `POST /mcp` **api** bucket applies |
| Auto-enable when `/mcp` mounts | Explicit `mcpServiceTokens: true` (Q7) |
| Profile-tab mint UI | Dedicated `/settings/mcp` route (Q13) |

## Decisions

| ID | Question | Decision |
| --- | --- | --- |
| Q1 | MCP surface | Consumer app `POST /mcp` on `@terreno/api` only |
| Q2 | Identity | Token acts as **owning user**; same `modelRouter` / `registerMCPTool` permissions; no scopes in v1 |
| Q3 | Transport | `Authorization: Bearer mcp_…`; plaintext shown **once** on create; never in URL |
| Q4 | Power | **MCP endpoint only** — not REST, sync, or admin |
| Q5 | Mint UX | Self-service API + example UI; new IP; hashed model in `@terreno/api` |
| Q6 | Expiry | Optional `expiresAt` on create; default **no expiry**; expired → 401 on `/mcp` |
| Q7 | Enablement | **`mcpServiceTokens: true`** on `TerrenoAppOptions` mounts routes + token auth |
| Q8 | Token shape | Prefix **`mcp_`** + 32 random bytes (hex); SHA-256 hash stored; verify **before** JWT parse |
| Q9 | Cap | Max **10** active (non-revoked, unexpired) tokens per user; 400 when over cap |
| Q10 | UI placement | New settings route + admin changelist (not Profile tab) |
| Q11 | Admin vs owner | Owners self-serve; **admins** list/revoke **all** users' tokens |
| Q12 | Admin implementation | Generic **`AdminApp` model** registration (no custom widget) |
| Q13 | User route | **`/settings/mcp`** in example-frontend |

### Recorded assumptions (implementation detail)

- Hash: `crypto.createHash("sha256")` (same as `AuthToken`).
- Display prefix: first 8 characters after `mcp_` (e.g. `mcp_a1b2c3d4…`) for list UIs.
- Revoke: set `revokedAt`; do not hard-delete rows (audit-friendly).
- `lastUsedAt` updated on successful MCP auth (throttle optional; v1 update every auth).
- Self-serve routes live at **`/mcp/service-tokens`** (session/JWT only).
- Admin CRUD at **`/admin/mcp-service-tokens`** via `AdminApp` (list + revoke; create/update disabled).
- `mcpUrl` in create response: `{publicApiUrl}/mcp` from new optional `mcpServiceTokens.publicMcpUrl` or `BETTER_AUTH_URL` / request host fallback.
- Perplexity: GET `/mcp` is a Streamable-HTTP **405** (no GET SSE stream). POST `initialize` / `tools/list` are unauthenticated catalog in the stateless handler. Identity is enforced on **`tools/call`**. Send the same Bearer on GET and POST anyway.

## Architecture

```
User (session)                External MCP client (Perplexity, etc.)
     |                                    |
     | POST /mcp/service-tokens          | POST|GET /mcp
     | GET  /mcp/service-tokens            | Authorization: Bearer mcp_…
     | DELETE /mcp/service-tokens/:id      |
     v                                    v
McpServiceToken model (hash only)   extractUserFromHeaders
     |                                    |
     |                                    +-- mcp_* ? verify hash -> User
     |                                    +-- else Better Auth session
     |                                    +-- else JWT
     v                                    v
AdminApp table (IsAdmin)            same User as REST MCP today
list / revoke all users
```

### Connection string (operator copy-paste)

Clients that accept JSON (Cursor, VS Code, Claude Code):

```json
{
  "mcpServers": {
    "my-app": {
      "url": "https://api.example.com/mcp",
      "headers": {
        "Authorization": "Bearer mcp_<secret-shown-once>"
      }
    }
  }
}
```

Perplexity custom connector form:

| Field | Value |
| --- | --- |
| MCP Server URL | `https://api.example.com/mcp` |
| Transport | Streamable HTTP |
| Authentication | API Key |
| API Key | full `mcp_…` string (Perplexity sends as Bearer) |

## Models

**`McpServiceToken`** (`api/src/models/mcpServiceToken.ts` + `api/src/types/mcpServiceToken.ts`)

| Field | Type | Notes |
| --- | --- | --- |
| `userId` | ObjectId ref User | owner; required; indexed |
| `name` | string | user label ("Perplexity laptop"); required; trim |
| `tokenPrefix` | string | display only, e.g. `a1b2c3d4` |
| `tokenHash` | string | SHA-256 of full `mcp_…`; unique |
| `expiresAt` | Date? | optional; TTL index when set |
| `revokedAt` | Date? | set on revoke |
| `lastUsedAt` | Date? | updated on MCP auth |

Plugins: `createdUpdatedPlugin`, `findOneOrNone`, `findExactlyOne`. **No** `isDeletedPlugin
(revoke is explicit). Statics: `issueFor(user, {name, expiresAt?})` → `{token, doc}`;
`verify(plaintext)` → `McpServiceTokenDocument | null` (not revoked, not expired);
`revokeForUser(user, id)`; `countActiveForUser(userId)`.

OpenAPI / admin metadata: **never** expose `tokenHash`. Create response is the only time
`token` plaintext appears.

## APIs

### Self-serve (`/mcp/service-tokens`)

Mounted only when `mcpServiceTokens: true`. All routes require session/JWT
(`authenticateMiddleware`); **reject** `mcp_` Bearer on these routes (401 — tokens cannot
mint tokens).

| Method | Path | Body / params | Response |
| --- | --- | --- | --- |
| POST | `/mcp/service-tokens` | `{name, expiresAt?}` | `{data: {id, name, token, tokenPrefix, mcpUrl, expiresAt, created}}` |
| GET | `/mcp/service-tokens` | `?page&limit` | `{data: [...], page, limit, total, more}` — no `token` field |
| DELETE | `/mcp/service-tokens/:id` | — | `{data: {id, revokedAt}}` — owner only |

Errors: 400 over cap (10); 404 not found / not owner; 401 unauthenticated.

### MCP auth (`extractUserFromHeaders`)

When `mcpServiceTokens` enabled and `Authorization` bearer starts with `mcp_`:

1. Hash and lookup active token.
2. Load `userId` → `User`; `rejectIfDisabled`.
3. Set `lastUsedAt` (fire-and-forget).
4. Return user (same type as JWT path).

Order: **service token → Better Auth session → JWT** (Q8).

### Admin (`AdminApp`)

Register on consuming app (example-backend):

```typescript
{
  model: McpServiceToken,
  routePath: "/mcp-service-tokens",
  displayName: "MCP service tokens",
  group: "Platform",
  listFields: ["name", "tokenPrefix", "userId", "lastUsedAt", "expiresAt", "revokedAt", "created"],
  permissions: {create: [], update: [], delete: [Permissions.IsAdmin], list: [Permissions.IsAdmin], read: [Permissions.IsAdmin]},
  // responseHandler strips tokenHash
}
```

Admin **delete** sets `revokedAt` (override default hard delete in `preDelete` or use
custom delete route).

## UI

### Example-frontend `/settings/mcp`

- Linked from Profile (button "MCP connections" → `/settings/mcp`).
- **Create:** name field, optional expiry date (`DateTimeField`), submit → modal with
  **copy-once** `mcpUrl`, full `token`, and JSON snippet.
- **List:** name, prefix, created, last used, expires, Revoke button.
- Uses generated SDK hooks after `bun run sdk`.
- Loading / error / empty states.

### Admin

Generic `AdminModelTable` via existing `[model]` routes — no new Expo screen.

## TerrenoApp integration

```typescript
new TerrenoApp({
  userModel: User,
  mcpServiceTokens: {
    enabled: true,
    publicMcpUrl: process.env.PUBLIC_API_URL, // optional; shown in create response
  },
});
```

Boolean `mcpServiceTokens: true` is shorthand for `{enabled: true}`.

When enabled:

1. Register self-serve routes (before or after `mountMCPServer` — order irrelevant).
2. Pass `mcpServiceTokens: true` into `MCPAuthContext` so `extractUserFromHeaders` verifies tokens.

`/mcp` mounting unchanged (still requires MCP tools). Token routes can mount even if no
tools yet (harmless); example-backend already exposes MCP.

## Phases

| Phase | Delivers |
| --- | --- |
| 1 | Model, issue/verify/revoke, `extractUserFromHeaders` integration, unit tests |
| 2 | Self-serve HTTP routes, `TerrenoApp` flag, OpenAPI |
| 3 | Example-backend flag + `AdminApp` registration |
| 4 | Example-frontend `/settings/mcp` + SDK + verification artifacts |
| 5 | Docs (how-to connect Perplexity, reference, explanation cross-link) |

## Feature Flags & Migrations

- No feature flag beyond `mcpServiceTokens` opt-in.
- New collection `mcpservicetokens` (mongoose default pluralization). No backfill.
- Index: `{userId: 1, revokedAt: 1}`, unique `tokenHash`, TTL on `expiresAt` when present.

## Activity Log & User Updates

- Optional: `logger.info` on mint/revoke with `userId` + `tokenPrefix` (never log full token).
- No email on mint in v1.

## Not Included / Future Work

- OAuth 2.1 ([app-mcp-server.md](app-mcp-server.md)) — use for Claude web connectors that cannot send static keys.
- Scoped tokens (read-only MCP, named tool allowlist).
- REST-wide personal access tokens.
- Token rotation / regenerate keeping same id.
- Audit log table for MCP calls per token.

## Files to Create / Modify

| Area | Files |
| --- | --- |
| Model | `api/src/models/mcpServiceToken.ts`, `api/src/types/mcpServiceToken.ts` |
| Routes | `api/src/mcp/serviceTokens.ts`, `api/src/mcp/serviceTokens.test.ts` |
| Auth | `api/src/mcp/auth.ts`, `api/src/mcp/auth.test.ts` |
| App | `api/src/terrenoApp.ts`, `api/src/index.ts` |
| Example backend | `example-backend/src/server.ts` (flag + admin model) |
| Example frontend | `example-frontend/app/settings/mcp.tsx`, `example-frontend/app/settings/_layout.tsx`, link from `profile.tsx`, SDK regen |
| Docs | `docs/how-to/connect-mcp-service-token.md`, `docs/how-to/expose-mcp-tools.md`, `docs/reference/api.md`, `docs/explanation/authentication.md` |

## Task List

See [`docs/tasks/mcp-service-tokens.md`](../tasks/mcp-service-tokens.md).

## Acceptance Criteria

| Criterion | Verification |
| --- | --- |
| Flag off: no `/mcp/service-tokens` routes; `mcp_` bearer on `/mcp` is ignored | `api` unit + integration test |
| Flag on: create returns `mcp_` plaintext once; list never includes it | Route tests |
| Active cap 10 per user | Route test returns 400 on 11th create |
| Optional expiry: expired token 401 on `/mcp` | Auth test + HTTP initialize |
| Revoked token 401 on `/mcp` | Auth test |
| Valid token: `tools/list` as owner user | Supertest MCP handler or `invokeMCPTool`-style test |
| Session JWT cannot call self-serve routes with `mcp_` only | Route test |
| Admin lists all users' tokens; admin revoke blocks MCP | Admin integration test |
| Perplexity-shaped GET `/mcp` is JSON-RPC 405; POST `tools/call` with same Bearer acts as owner | HTTP integration test + how-to |
| Example `/settings/mcp` create-copy-revoke flow | Manual UI + artifact |
| Docs: Perplexity form fields + JSON snippet | Doc review |
