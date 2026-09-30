# Implementation Plan: App MCP server

**Status:** Draft  
**Roadmap:** Area=`mcp`, Target=`Future`, Impact=`Feature`  
**Created:** 2026-08-24  
**Owner:** unassigned  
**Depends on:** [model-router-mcp.md](model-router-mcp.md) (shipped), [mcp-boost-parity.md](mcp-boost-parity.md) (dev-time MCP — sibling, not a blocker)  
**Roadmap issue:** TBD after Approve (`roadmap-item`)

Follow-up to the Boost IP. That plan is the **development-time** MCP (`@terreno/mcp` + `terreno-mcp-local`): agents writing Terreno apps. This plan is the **running app** as an MCP server: ChatGPT, Claude, Cursor, Inspector, and in-app agents calling the consumer backend.

## Goal

A Terreno backend exposes a complete MCP product surface — tools, prompts, resources, named HTTP servers, OAuth 2.1 for remote clients, Inspector/test DX, a Streamable HTTP client, and hosted generators for those primitives — without giving up generated CRUD tools that stay aligned with `modelRouter` permissions.

When this is done, an operator can:

1. Keep `mcp: { methods: ["list", "read"] }` on `modelRouter` (already shipped).
2. Register a custom tool / prompt / resource with the same auth user as REST.
3. Optionally mount a second server at `/mcp/admin` (or similar) with a subset of primitives.
4. Connect remote MCP clients via Better Auth OAuth 2.1 (discovery + PKCE + access token), while JWT/session bearer still works for Inspector and in-app hooks.
5. Hit the endpoint with MCP Inspector and assert tool calls in Bun tests without speaking JSON-RPC by hand.
6. Use `@terreno/ai` `MCPService` over Streamable HTTP (the transport `/mcp` already speaks).
7. Ask the hosted `@terreno/mcp` to emit `defineMCPTool` / `defineMCPPrompt` / `defineMCPResource` snippets.

## Non-goals

| Out | Why |
| --- | --- |
| Hosted `@terreno/mcp` docs search, local CDP logs, simulator control | Boost IP |
| MCP Apps (`ui://` HTML iframes) | Spec still moving; no Terreno UI host |
| Class-hierarchy primitive APIs | TS factories + hosted snippet generators |
| stdio transport for **app** MCP | Product path is HTTP; local stdio is the Boost companion |
| Streaming/progress generators, resource subscriptions | Defer |
| Changing generated CRUD tool names or default read-only methods | Compat |
| Privileged infra tools (GCP, Sentry, …) | [infra-mcp.md](infra-mcp.md) — reuse the same Better Auth MCP OAuth plugins, different host |

## Why this is a separate IP

| Layer | Terreno today |
| --- | --- |
| Dev-time (“teach the agent the framework”) | `@terreno/mcp` + Boost IP |
| Runtime (“the app *is* an MCP server”) | `modelRouter` `mcp` + `registerMCPTool` on `POST /mcp` |

[model-router-mcp.md](model-router-mcp.md) deferred resources and prompts. Generated CRUD is already the differentiator (`mcp:` on `modelRouter` ⇒ permissioned tools). This IP fills the rest of the MCP server kit: prompts, resources, named mounts, remote-client OAuth, test/Inspector DX, client transport, and generators.

## Current code (leaves)

| Seam | Behavior |
| --- | --- |
| `api/src/mcp/server.ts` `mountMCPServer` | Stateless `createMcpHandler`, `POST /mcp`, tools capability only |
| `api/src/mcp/toolGenerator.ts` | `{prefix}_{list,read,create,update,delete}` from registry |
| `api/src/mcp/registry.ts` `registerMCPTool` | Custom tools: `name`, `description`, `zodSchema`, `handler` |
| Auth | `extractUserFromHeaders` — opt-in `mcp_` [service tokens](mcp-service-tokens.md), then Better Auth session, then JWT. No OAuth 2.1 resource server yet; no RFC 9728 metadata. Operator how-to: [Connect an MCP client with a service token](../how-to/connect-mcp-service-token.md) |
| `@terreno/ai` `MCPService` | **SSE** client only — mismatch with Streamable HTTP server |
| `@terreno/rtk` `useMCPTools` | Official MCP client, Streamable HTTP to `/mcp` |
| Tests | Registry/handler/integration tests; no Inspector helper, no prompt/resource tests |
| `@terreno/mcp` | Codegen for models/routes/screens; no generators for app MCP primitives |

## Decisions

| ID | Question | Choice |
| --- | --- | --- |
| Q1 | Scope vs Boost | **App MCP on `@terreno/api`.** Hosted `@terreno/mcp` only gains generators *of* app primitives (Q12). |
| Q2 | Primitive shape | **Factories:** `defineMCPTool` / `defineMCPPrompt` / `defineMCPResource` wrapping `registerMCP*`. |
| Q3 | Default endpoint | **Keep `/mcp`.** Additive capabilities. No rename. |
| Q4 | Multiple servers | **Yes, v1.** Named mounts with explicit include lists. Default `/mcp` remains the union of CRUD + globally registered primitives. Extra servers are opt-in and do not auto-include every model tool. |
| Q5 | Auth | **Bearer (JWT + Better Auth session) plus OAuth 2.1 for MCP** via Better Auth (`@better-auth/mcp` + `@better-auth/oauth-provider`). Same User as REST after token exchange. JWT-only apps keep bearer-only; OAuth metadata mounts only when Better Auth is enabled. |
| Q6 | Tool metadata | **MCP spec hints:** `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`, plus optional `outputSchema` + `structuredContent`. |
| Q7 | Conditional register | **`shouldRegister(user)`** (and optional `shouldRegister: false`). Filter list methods and reject call/get/read if hidden. |
| Q8 | Response helper | **`mcpResult.text` / `.json` / `.error`.** Images/audio out. |
| Q9 | Client | **Upgrade `MCPService` to Streamable HTTP**; add list/get prompts and list/read resources. Named clients stay a `Record` keyed by name. |
| Q10 | MCP Apps / streaming | **Out.** OAuth is in (Q5), not in this row. |
| Q11 | Test DX | **`invokeMCPTool` / `invokeMCPPrompt` / `readMCPResource`** against an in-process Express app. Document MCP Inspector; do not vendor Inspector. |
| Q12 | Codegen on hosted MCP | **In.** `terreno_generate_mcp_tool`, `terreno_generate_mcp_prompt`, `terreno_generate_mcp_resource` on `@terreno/mcp` emit factory snippets. Required, not optional. |

## Architecture

```
MCP client (Inspector, Claude, ChatGPT, useMCPTools, MCPService)
        │  Bearer JWT/session  OR  OAuth 2.1 access token (Better Auth)
        ▼
 POST /mcp              ← default union (CRUD + global registerMCP*)
 POST /mcp/:serverName  ← optional named server (explicit primitives)
 GET  /.well-known/oauth-protected-resource   ← RFC 9728 (Better Auth on)
        │
        ├─ tools     (generated CRUD + defineMCPTool)
        ├─ prompts   (defineMCPPrompt)
        └─ resources (defineMCPResource)
              │
              ▼
     same User as REST → permissions / queryFilter / hooks
```

### Public API (target)

```typescript
import {
  defineMCPPrompt,
  defineMCPResource,
  defineMCPTool,
  mcpResult,
  mountMCPServer,
} from "@terreno/api";
import {z} from "zod";

defineMCPTool({
  name: "weather_current",
  description: "Current forecast for a city.",
  annotations: {readOnlyHint: true, openWorldHint: true},
  zodSchema: z.object({city: z.string()}),
  outputSchema: z.object({tempC: z.number(), summary: z.string()}),
  shouldRegister: (user) => Boolean(user),
  handler: async ({city}, user) => {
    return mcpResult.json({tempC: 22, summary: `Clear in ${city}`});
  },
});

defineMCPPrompt({
  name: "weather_briefing",
  description: "Ask the model to summarize weather for a user.",
  arguments: [{name: "city", required: true, description: "City name"}],
  handler: async ({city}) => ({
    messages: [{role: "user", content: {type: "text", text: `Brief the weather in ${city}.`}}],
  }),
});

defineMCPResource({
  uri: "weather://guidelines",
  name: "weather_guidelines",
  mimeType: "text/markdown",
  handler: async () => mcpResult.text("# Use metric units."),
});

mountMCPServer(expressApp, {
  path: "/mcp/weather",
  name: "weather",
  instructions: "Weather tools only.",
  tools: ["weather_current"],
  prompts: ["weather_briefing"],
  resources: ["weather://guidelines"],
});
```

`defineMCP*` is sugar over `registerMCP*` (same registry). Existing `registerMCPTool` calls keep working.

`TerrenoApp` continues to auto-mount `/mcp` when the registry is non-empty. Named extra servers are registered via `app.mcpServer({path, ...})` or `mountMCPServer` in `configureApp`.

CRUD tools get annotations: list/read `readOnlyHint: true`; create/update `idempotentHint: false`; delete `destructiveHint: true`.

### Auth (Q5)

Remote MCP clients (Claude connectors, ChatGPT, Cursor HTTP) expect **OAuth 2.1** with protected-resource metadata, not a hand-pasted JWT.

**When Better Auth is enabled** (`BetterAuthApp` / `AUTH_PROVIDER=better-auth`):

1. Add `@better-auth/mcp` and `@better-auth/oauth-provider` to `@terreno/api`, same plugins [infra-mcp.md](infra-mcp.md) plans to use.
2. Register the MCP plugin on the Better Auth instance Terreno already builds (login page = existing Better Auth sign-in).
3. Serve RFC 9728 `/.well-known/oauth-protected-resource` (and authorization-server discovery that the plugin provides, typically under the Better Auth base path).
4. On unauthenticated `/mcp` requests, return **401** with `WWW-Authenticate` pointing at that metadata (MCP authorization spec).
5. Extend `extractUserFromHeaders` to accept an OAuth access token on `Authorization: Bearer`, resolve it through Better Auth, then load the app `User` by `betterAuthId` — same mapping as session cookies today.
6. Keep JWT verification as a fallback so Inspector, tests, and `useMCPTools` keep working with session/JWT bearer.

**When Better Auth is off (JWT-only):** do not mount OAuth metadata. Bearer JWT behavior is unchanged. Docs state that ChatGPT-class connectors need Better Auth.

**Not in this IP:** social login providers (already documented); infra-mcp’s RBAC/elicitation; replacing Passport JWT for REST.

Align plugin versions with the infra-mcp catalog pins so the two servers do not fork OAuth behavior.

### Client (`@terreno/ai`)

`MCPService` transport becomes Streamable HTTP (SDK `StreamableHTTPClientTransport` or AI SDK equivalent). Keep SSE as `transport: "sse"` for old servers. Add `listPrompts` / `getPrompt` / `listResources` / `readResource`. Optional `auth: { oauth: ... }` can wait until the server OAuth path exists; bearer header injection stays the default for in-process agents.

`getMCPTools` (in-process) includes custom tools unchanged; prompts/resources stay MCP-protocol-only unless a later IP asks for in-process prompt runners.

### Testing

```typescript
const res = await invokeMCPTool(app, {
  name: "weather_current",
  arguments: {city: "Austin"},
  user: adminUser,
});
expect(res.isError).toBe(false);
```

Helper authenticates as `user`, POSTs `tools/call` (or uses the SDK), returns parsed result. OAuth tests cover: 401 + `WWW-Authenticate` without a token; a Better Auth–issued access token maps to the same user as REST.

### Hosted generators (Q12)

On `@terreno/mcp` (hosted HTTP server, not `terreno-mcp-local`):

| Tool | Emits |
| --- | --- |
| `terreno_generate_mcp_tool` | `defineMCPTool({...})` snippet |
| `terreno_generate_mcp_prompt` | `defineMCPPrompt({...})` snippet |
| `terreno_generate_mcp_resource` | `defineMCPResource({...})` snippet |

Inputs: name, description, input fields (tool), arguments (prompt), URI/mime (resource). Output is TypeScript that typechecks against the public factories. Tool descriptions tell agents to prefer these over inventing `registerMCPTool` shapes.

## Docs (same slice as code — Pick)

| Diátaxis | Page |
| --- | --- |
| Explanation | `docs/explanation/app-mcp.md` — two MCP layers (Boost vs app), generated CRUD vs registered primitives, Better Auth OAuth vs JWT bearer |
| How-to | Expand `docs/how-to/expose-mcp-tools.md`; add `docs/how-to/add-mcp-prompts-and-resources.md`; Inspector; `docs/how-to/secure-app-mcp.md` (OAuth + bearer) |
| Reference | `docs/reference/api.md` MCP section: factories, annotations, named servers, OAuth well-known routes; `docs/reference/mcp-server.md` generator tools |
| Example | `example-backend` registers one prompt + resource + annotated custom tool; README for Inspector and OAuth when Better Auth is on |

`update-docs` on every phase that changes public API. Bundled `@terreno/mcp` resources that mention app MCP must match.

## Phases

### Phase 1 — Prompts, resources, richer tools on `/mcp`

Tracer: example-backend custom tool already exists (`users_todo_statuses`). Add one prompt + one resource; Inspector `prompts/list` and `resources/list` succeed with a bearer token.

- Registry for prompts/resources; `shouldRegister`; annotations; `outputSchema` / structured content when SDK supports it; `mcpResult`.
- `mountMCPServer` advertises `prompts` and `resources` capabilities. **Mount `/mcp` when any primitive exists**, not only when `getAllMCPTools().length > 0`.
- Tests: list/call/get/read; hidden primitive absent from list and rejected on call; CRUD tools still work.

### Phase 2 — Named HTTP servers

- `mountMCPServer(app, {path, name, instructions, tools?, prompts?, resources?})`.
- Default `/mcp` union unchanged when extra servers exist.
- Empty include list on a named server ⇒ that primitive kind empty (no surprise CRUD leak).
- Tests: tool on `/mcp` not listed on `/mcp/weather` unless included.

### Phase 3 — Factories + hosted generators

- Export `defineMCPTool|Prompt|Resource`.
- Example-backend uses `defineMCP*` for the tracer primitives.
- Hosted MCP tools `terreno_generate_mcp_tool|prompt|resource` (required).

### Phase 4 — Inspector + `invokeMCP*`

- Test helpers in `api/src/mcp/testHelpers.ts` (or `api/src/tests/` if that is the existing helper home).
- How-to: `bunx @modelcontextprotocol/inspector` against example-backend `/mcp`.
- Assertions: `isError`, text contains, structured JSON.

### Phase 5 — `MCPService` Streamable HTTP + prompts/resources

- Default HTTP transport matches server.
- Tests with a mock Streamable HTTP server or example-backend.
- `useMCPTools` already HTTP — no change unless headers break.

### Phase 6 — MCP OAuth 2.1 via Better Auth

- Catalog deps: `@better-auth/mcp`, `@better-auth/oauth-provider` as required by that plugin.
- Wire plugin in Better Auth setup used by `BetterAuthApp`.
- RFC 9728 + 401 `WWW-Authenticate` on `/mcp`.
- `extractUserFromHeaders` accepts OAuth access tokens.
- JWT-only apps unchanged.
- How-to `docs/how-to/secure-app-mcp.md`; reference well-known paths.
- Tests with Better Auth test instance: no token → 401 challenge; valid access token → `tools/list` as that user.

## Notifications

None.

## UI

No new screens. Example-frontend chat already uses MCP tools; optional follow-up to surface prompt names is out of scope. OAuth consent uses Better Auth’s existing login page.

## Feature flags & migrations

None. Additive APIs. `registerMCPTool` signature may gain optional fields only. OAuth is additive when Better Auth is on.

## Risks

| Risk | Mitigation |
| --- | --- |
| MCP SDK prompt/resource APIs differ by SDK version | Pin to the SDK `createMcpHandler` already uses; wrap in `api/src/mcp/` |
| Tool list cardinality explodes with CRUD × models × extras | Named servers + `shouldRegister`; docs tell operators to split |
| `MCPService` SSE clients in the wild | Keep `transport: "sse"`; default new HTTP |
| Structured output clients ignore `outputSchema` | Always include a text content part |
| Better Auth MCP plugin vs current session extraction | One `extractUserFromHeaders` pipeline: session → OAuth token → JWT |
| Duplicate OAuth stacks vs infra-mcp | Same plugins and catalog versions; different Express app |
| Dynamic client registration abuse | Follow plugin defaults; document production redirect allowlists |

## Future work (not this IP)

- MCP Apps / `ui://` HTML
- Resource templates (`weather://forecast/{city}`) if SDK templates are stable
- Progress notifications / streaming tool handlers
- Rate limiting (already deferred on model-router-mcp)
- MCPService performing the OAuth redirect dance itself (server + bearer is v1)

## Files to create / modify (expected)

| Area | Files |
| --- | --- |
| API | `api/src/mcp/registry.ts`, `server.ts`, `toolGenerator.ts`, `types.ts`, `auth.ts`, new `prompts.ts` / `resources.ts` / `result.ts` / `testHelpers.ts` + tests |
| Better Auth | `api/src/betterAuthSetup.ts` (or equivalent), `package.json` catalog deps |
| App | `api/src/terrenoApp.ts`, `api/src/index.ts` |
| AI | `ai/src/service/mcpService.ts` + tests |
| Hosted MCP | `mcp-server/src/tools.ts` + tests |
| Example | `example-backend` MCP module + README |
| Docs | explanation + how-tos + `docs/reference/api.md` + `docs/reference/mcp-server.md` |

## Task list

[`docs/tasks/app-mcp-server.md`](../tasks/app-mcp-server.md)

## Acceptance criteria

- [ ] `prompts/list` and `resources/list` work on `/mcp` when primitives are registered
- [ ] `shouldRegister: false` hides the primitive from list and call
- [ ] CRUD tools keep REST permission behavior
- [ ] A named server at a second path exposes only its include list
- [ ] `invokeMCPTool` can assert a successful custom tool in Bun tests
- [ ] `MCPService` can list tools over Streamable HTTP against `mountMCPServer`
- [ ] Better Auth on: unauthenticated `/mcp` returns 401 with resource metadata; a valid OAuth access token runs tools as that user
- [ ] JWT-only: existing bearer behavior unchanged; no OAuth well-known required
- [ ] Hosted `terreno_generate_mcp_tool|prompt|resource` return TypeScript matching the factories
- [ ] Docs: two MCP layers; prompts/resources; Inspector; OAuth vs bearer; generator tools
- [ ] `registerMCPTool` without new fields still typechecks and runs
