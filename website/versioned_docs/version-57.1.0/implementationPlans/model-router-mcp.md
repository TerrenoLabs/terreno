# Implementation Plan: modelRouter MCP Tools

**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1092
*When an engineer is assigned to a project but before you begin coding, you should fill in the implementation plan and get feedback from the engineering team. Once you have finished or you make any changes, tag Josh with the @ symbol so he can review. Also tag anyone else that needs to be notified, has conflicting work, etc.*

## Overview

Add MCP (Model Context Protocol) tool generation to `@terreno/api`'s `modelRouter`. Each modelRouter can opt-in to exposing its CRUD operations as MCP tools via an `mcp` config option. When models with MCP config are added to `TerrenoApp`, their tools are registered automatically. On server start, if any models have MCP config, a `/mcp` endpoint is auto-mounted — zero extra setup.

This makes every Terreno app instantly AI-native: any model becomes callable by LLMs with the same permission, filtering, and population guarantees as REST.

**Key design decisions:**
- Safe defaults: `methods` defaults to `['list', 'read']` (read-only), `maxLimit` defaults to 50
- `excludeFields` allows hiding sensitive/regulated fields from MCP tool schemas and responses
- MCP config lives on each `modelRouter` call (per-model opt-in)
- `TerrenoApp` aggregates all MCP-enabled models into a single `/mcp` endpoint
- `modelRouter` return type is unchanged — MCP registration is a side effect (same pattern as OpenAPI)
- Auth-agnostic: works with both JWT and Better Auth
- Tool naming: `{prefix}_list`, `{prefix}_read`, `{prefix}_create`, `{prefix}_update`, `{prefix}_delete`
- Populate is an option on the read tool, not a separate tool
- Also exports `getMCPTools()` from `@terreno/ai` returning Vercel `ai` SDK `CoreTool` objects for direct in-process use
- Custom tools via `registerMCPTool` (example: `users_todo_statuses`)

**Related work:** The `ai-multimodal-tools-mcp` branch has `MCPService` (MCP client) and `AIService` in `@terreno/ai` — that's the consumer of what this plan builds.

## Models

No new Mongoose models or database changes. New TypeScript interfaces added to `@terreno/api`:

### MCPConfig (on ModelRouterOptions)

```typescript
// api/src/mcp/types.ts

export interface MCPConfig {
  methods?: Array<'create' | 'list' | 'read' | 'update' | 'delete'>; // Default: ['list', 'read']
  description?: string;            // Override auto-generated model description
  toolPrefix?: string;             // Override tool name prefix (default: pluralized model name)
  excludeFields?: string[];        // Fields to hide from MCP tool schemas and responses
                                   // e.g. ['internalNote', '__v', 'metadata.secretKey']
  maxLimit?: number;               // Max items returned by list tool (default: 50)
  mcpResponseHandler?: (          // MCP-specific serialization (separate from REST responseHandler)
    value: any,
    method: 'create' | 'list' | 'read' | 'update' | 'delete',
    user?: User
  ) => Promise<JSONValue>;
}

// Added to existing ModelRouterOptions<T>
export interface ModelRouterOptions<T> {
  // ... all existing fields unchanged ...
  mcp?: MCPConfig;  // NEW — opt-in MCP tool generation
}
```

### Internal Registry

```typescript
// api/src/mcp/registry.ts

interface MCPRegistryEntry {
  modelName: string;
  model: Model<any>;
  config: MCPConfig;
  options: ModelRouterOptions<any>;  // full router options for permissions, population, etc.
}

// Global registry — modelRouter() pushes to this when mcp config is present
// TerrenoApp reads from this on startup
const mcpRegistry: MCPRegistryEntry[] = [];
```

## APIs

No new REST endpoints. One MCP protocol endpoint and auto-generated tools.

### MCP Endpoint

| Method | Path | Description |
|--------|------|-------------|
| POST | `/mcp` | MCP JSON-RPC 2.0 handler via `StreamableHTTPServerTransport` |

Auto-mounted by `TerrenoApp` on startup if any registered models have `mcp` config.

### Auto-generated MCP Tools

For each model with `mcp` config, tools are generated based on `mcp.methods`:

| Tool Name | Generates When | Input Schema | Output |
|-----------|---------------|--------------|--------|
| `{prefix}_list` | `'list'` in methods | `{ query?, page?, limit?, sort?, populate? }` | `{ data, total, page, more }` (limit capped at `maxLimit`, default 50) |
| `{prefix}_read` | `'read'` in methods | `{ id, populate? }` | `{ data }` |
| `{prefix}_create` | `'create'` in methods | Model fields from Mongoose schema | `{ data }` |
| `{prefix}_update` | `'update'` in methods | `{ id, ...partial model fields }` | `{ data }` |
| `{prefix}_delete` | `'delete'` in methods | `{ id }` | `{ success: true }` |

### Auth Flow (per tool call)

1. Extract headers from MCP transport
2. Call auth provider (JWT or Better Auth) to get user — same logic as `authenticateMiddleware`
3. Run `checkPermissions()` with the user and method
4. For read/update/delete: load document, run object-level permission check
5. Apply `queryFilter` for list operations
6. Apply `populatePaths` (default) + optional extra `populate` param from tool input
7. Strip `excludeFields` from response data
8. Serialize through `mcpResponseHandler` if provided, otherwise default serialization

### Tool Description Auto-generation

Generated from model name, field names/types, and `queryFields`. Example:
> "List todo items. Filterable by: completed, status, ownerId. Sortable. Paginated (default 50, max controlled by maxLimit)."

`mcp.description` overrides the auto-generated description.

### CoreTool Export

`getMCPTools()` exported from `@terreno/ai` returns all registered MCP tools as `Record<string, CoreTool>` for direct use with the Vercel `ai` SDK's `streamText()` / `generateText()`.

## Notifications

No notifications required for this feature. This is framework-level infrastructure.

## UI

### RTK Query Hooks (`@terreno/rtk`)

- `useMCPTools()` — returns all available MCP tools from the connected backend via MCP client tool discovery
- Handles Bearer token injection from auth state (JWT or Better Auth)

### ai SDK React Integration (`@terreno/rtk`)

- `useTerrenoChat({ baseURL, tools? })` — wraps `@ai-sdk/react`'s `useChat()` pre-configured for the Terreno backend's MCP endpoint
- Streams tool calls and results to the UI
- Works with React Native (Expo) via existing RTK/Redux store for auth state

### Example App

- Demo chat screen in `example-frontend` showing `useTerrenoChat()` connected to MCP-enabled models

## Phases

### Phase 1: Core MCP Infrastructure (`@terreno/api`)
- MCP types and config (`MCPConfig`, registry)
- Tool generation from modelRouter options + Mongoose schema (Zod schemas from model)
- MCP server setup with `@modelcontextprotocol/sdk` in TerrenoApp
- Auth-agnostic user extraction from MCP transport headers
- Permission checking, query filtering, population in tool handlers
- `getMCPTools()` export for direct CoreTool usage
- Tests for tool generation, permissions, CRUD operations over MCP
- **Deliverable:** Any Terreno app can add `mcp` to a modelRouter and get a working `/mcp` endpoint

### Phase 2: Frontend Integration (`@terreno/rtk`)
- `useTerrenoChat()` hook wrapping `@ai-sdk/react` `useChat()`
- Auth token injection (JWT + Better Auth)
- `useMCPTools()` hook for tool discovery
- **Deliverable:** Frontend can connect to MCP-enabled backend with typed hooks

### Phase 3: Examples & Polish
- Example backend: add `mcp` config to existing Todo/Food models
- Example frontend: demo chat screen using `useTerrenoChat()`
- Auto-generated tool descriptions refinement
- Documentation in example apps
- **Deliverable:** Working full-stack demo of AI-native Terreno app

## Feature Flags & Migrations

**Feature flags:** None. MCP is opt-in per model via `mcp` config. No models have it = nothing is mounted. Zero impact on existing apps.

**Data migrations:** None. No schema changes, no new collections.

**Rollout:** Minor version bump of `@terreno/api`. Existing apps upgrade and add `mcp` configs at their own pace. No breaking changes.

## Activity Log & User Updates

No activity logging specific to this feature. MCP tool calls go through the same permission/hook pipeline as REST — any existing `postCreate`/`postUpdate`/`postDelete` hooks fire normally for write operations.

## Not Included / Future Work

- **Rate limiting** — structured for future hooks but not implemented
- **MCP resources/prompts** — only tools generated from modelRouter plus `registerMCPTool`
- **Array operation tools** — handled via update, no dedicated push/patch/delete array tools
- **WebSocket transport** — HTTP/SSE only
- **Admin dashboard** — use `getMCPTools()` programmatically or MCP client tool listing
- **Streaming list results** — pagination only
- **Per-tool rate limiting or cost tracking**
- **MCP tool versioning**
- **Auto-generated RTK hooks per model** — codegen from OpenAPI (stretch goal)
