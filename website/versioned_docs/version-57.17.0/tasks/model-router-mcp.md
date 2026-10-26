# Tasks: modelRouter MCP Tools

*Structured task breakdown for automated implementation. Each task should be independently implementable and testable.*

---

### Phase 1: Core MCP Infrastructure

- [x] **Task 1.1**: Define MCP types and interfaces
  - Description: Create `MCPConfig` interface (with `methods` defaulting to `['list', 'read']`, `excludeFields` for hiding sensitive fields, `maxLimit` defaulting to 50), `MCPRegistryEntry`, and add `mcp?: MCPConfig` to `ModelRouterOptions`. Create the `api/src/mcp/` directory structure.
  - Files: `api/src/mcp/types.ts`, `api/src/mcp/index.ts`, `api/src/api.ts` (add mcp to ModelRouterOptions)
  - Depends on: none
  - Acceptance: Types compile, existing tests still pass, `mcp` is an optional field on `ModelRouterOptions`

- [x] **Task 1.2**: Build MCP tool registry
  - Description: Create a global registry that collects MCP tool entries as `modelRouter()` is called. When a modelRouter has `mcp` config, it pushes an entry to the registry. Export `getMCPRegistry()` from `@terreno/api`. Vercel AI SDK wrapping lives in `getMCPTools()` on `@terreno/ai`.
  - Files: `api/src/mcp/registry.ts`, `api/src/mcp/index.ts`, `api/src/api.ts` (register in modelRouter function)
  - Depends on: Task 1.1
  - Acceptance: Calling `modelRouter(Todo, { ..., mcp: { methods: ['list', 'read'] } })` adds entries to the registry. `getMCPRegistry()` returns those entries.

- [x] **Task 1.3**: Generate Zod schemas from Mongoose models
  - Description: Build a utility that converts a Mongoose model's schema into Zod schemas suitable for MCP tool `inputSchema`. Handle common field types (String, Number, Boolean, Date, ObjectId, Array, Mixed). Generate separate schemas for create (required fields), update (all optional + id required), read (id + optional populate), list (queryFields + pagination), and delete (id only). Respect `excludeFields` — omit listed fields from all generated schemas.
  - Files: `api/src/mcp/schemaGenerator.ts`, `api/src/mcp/schemaGenerator.test.ts`
  - Depends on: Task 1.1
  - Acceptance: Given a Mongoose model, produces valid Zod schemas for each CRUD method. Tests cover all common field types. `excludeFields` removes specified fields from schemas.

- [x] **Task 1.4**: Generate MCP tool definitions from registry entries
  - Description: Build tool generator that takes an `MCPRegistryEntry` and produces both `@modelcontextprotocol/sdk` `Tool` objects (JSON Schema input) and Vercel `ai` SDK `CoreTool` objects. Auto-generate descriptions from model name, fields, and queryFields. Apply `toolPrefix` naming (`{prefix}_{method}`). Only generate tools for methods listed in `mcp.methods`.
  - Files: `api/src/mcp/toolGenerator.ts`, `api/src/mcp/toolGenerator.test.ts`
  - Depends on: Task 1.2, Task 1.3
  - Acceptance: Registry entry with `methods: ['list', 'read']` produces exactly `todos_list` and `todos_read` tools with correct schemas and descriptions.

- [x] **Task 1.5**: Implement MCP tool handlers (CRUD execution)
  - Description: Build the execute functions for each CRUD tool. Each handler: (1) extracts user from auth context, (2) checks permissions via `checkPermissions()`, (3) for read/update/delete: loads document and checks object-level permissions, (4) applies queryFilter and population for list, (5) enforces `maxLimit` cap on list results (default 50), (6) runs pre/post hooks, (7) strips `excludeFields` from response data, (8) serializes via `mcpResponseHandler` or default. Reuse internal logic from REST handlers but decoupled from Express req/res.
  - Files: `api/src/mcp/handlers.ts`, `api/src/mcp/handlers.test.ts`
  - Depends on: Task 1.4
  - Acceptance: Each CRUD handler works with correct permission checks, population, filtering. List enforces maxLimit. excludeFields are stripped from responses. Tests cover: successful CRUD, permission denied (403), not found (404), validation errors, owner filtering, population, maxLimit enforcement, excludeFields stripping.

- [x] **Task 1.6**: Auth-agnostic user extraction for MCP
  - Description: Build middleware/utility that extracts user from MCP transport headers using whichever auth provider is configured (JWT via passport or Better Auth via `auth.api.getSession()`). Should mirror `authenticateMiddleware` behavior but work with raw headers instead of Express req.
  - Files: `api/src/mcp/auth.ts`, `api/src/mcp/auth.test.ts`
  - Depends on: Task 1.1
  - Acceptance: Given headers with a valid JWT, returns User. Given headers with a valid Better Auth session token, returns User. Given no/invalid headers with `allowAnonymous: false`, returns null. Works with both auth providers.

- [x] **Task 1.7**: Mount MCP server in TerrenoApp
  - Description: In `TerrenoApp`'s startup flow, check if the MCP registry has any entries. If so, create an `McpServer` instance from `@modelcontextprotocol/sdk`, register all tools from the registry, set up `StreamableHTTPServerTransport`, and mount on `/mcp`. Wire up `ListToolsRequestSchema` and `CallToolRequestSchema` handlers.
  - Files: `api/src/mcp/server.ts`, `api/src/expressServer.ts` (or TerrenoApp equivalent — integrate into startup)
  - Depends on: Task 1.4, Task 1.5, Task 1.6
  - Acceptance: Starting a TerrenoApp with MCP-configured models auto-mounts `/mcp`. MCP clients can list tools and call them. No MCP config = no `/mcp` endpoint.

- [x] **Task 1.8**: Integration tests
  - Description: End-to-end tests that spin up a TerrenoApp with MCP-configured models and test the full flow: MCP client connects, lists tools, performs CRUD via tool calls, verifies permissions block unauthorized access, verifies population and query filtering work.
  - Files: `api/src/mcp/integration.test.ts`
  - Depends on: Task 1.7
  - Acceptance: Full CRUD lifecycle works over MCP. Permission denials return appropriate errors. Owner filtering restricts results. Population returns nested data.

- [x] **Task 1.9**: Export public API
  - Description: Export `MCPConfig` and MCP registry/server helpers from `@terreno/api`. Export `getMCPTools()` from `@terreno/ai` so the Vercel `ai` SDK stays out of `@terreno/api`.
  - Files: `api/src/index.ts`, `ai/src/index.ts`, `ai/src/service/getMCPTools.ts`
  - Depends on: Task 1.7
  - Acceptance: Consumers can `import { MCPConfig } from "@terreno/api"` and `import { getMCPTools } from "@terreno/ai"`.

---

### Phase 2: Frontend Integration

- [x] **Task 2.1**: `useTerrenoChat` hook
  - Description: Create a hook wrapping `@ai-sdk/react`'s `useChat()` pre-configured for a Terreno MCP backend. Handles Bearer token injection from auth state (reads from Redux store — JWT token or Better Auth session). Accepts `baseURL` and optional `tools` override.
  - Files: `rtk/src/useTerrenoChat.ts`
  - Depends on: Task 1.7
  - Acceptance: Hook connects to MCP-enabled backend, streams responses with tool calls, injects auth token automatically.

- [x] **Task 2.2**: `useMCPTools` hook
  - Description: Create a hook that discovers available MCP tools from the backend via JSON-RPC call to /mcp endpoint. Caches result. Returns typed tool list.
  - Files: `rtk/src/useMCPTools.ts`
  - Depends on: Task 1.7
  - Acceptance: Hook returns list of available tools with names, descriptions, and input schemas. Handles connection errors gracefully.

- [x] **Task 2.3**: Export frontend public API
  - Description: Export `useTerrenoChat` and `useMCPTools` from `@terreno/rtk`. Add `@ai-sdk/react` and `ai` as dependencies.
  - Files: `rtk/src/index.ts`, `rtk/package.json`
  - Depends on: Task 2.1, Task 2.2
  - Acceptance: Consumers can `import { useTerrenoChat, useMCPTools } from "@terreno/rtk"`.

---

### Phase 3: Examples & Polish

- [x] **Task 3.1**: Add MCP config to example backend models
  - Description: Add `mcp` config to the existing Todo and User models in `example-backend`. Todos: read-only (`list`, `read`) with excludeFields. Users: read-only (`list`, `read`) with sensitive fields excluded.
  - Files: `example-backend/src/api/todos.ts`, `example-backend/src/api/users.ts`
  - Depends on: Task 1.9
  - Acceptance: Starting example-backend mounts `/mcp` with todo and user tools. MCP client can list and call them.

- [x] **Task 3.2**: Demo chat screen in example frontend
  - Description: Add a simple chat screen to `example-frontend` that uses `useTerrenoChat()` to connect to the MCP-enabled backend. Show tool calls inline (e.g., "Searching todos..." with results). Navigation from home screen.
  - Files: `example-frontend/app/chat.tsx`, `example-frontend/app/_layout.tsx` (add nav)
  - Depends on: Task 2.3, Task 3.1
  - Acceptance: User can chat with the AI, which calls MCP tools to query/modify data. Tool calls and results visible in the UI.

- [x] **Task 3.3**: Refine auto-generated tool descriptions
  - Description: Improve description generation quality. Include field types, required vs optional, enum values, ref model names. Test with multiple model shapes to ensure descriptions are helpful for LLMs.
  - Files: `api/src/mcp/toolGenerator.ts`, `api/src/mcp/toolGenerator.test.ts`
  - Depends on: Task 1.4
  - Acceptance: Descriptions include actionable detail. LLM can understand what each tool does and what inputs are expected without additional context.
