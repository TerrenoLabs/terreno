# Expose Model Context Protocol Tools

Turn a `modelRouter` model into Model Context Protocol (MCP) tools that an LLM can call, reusing the permissions, query filters, population, and lifecycle hooks you already declared for REST.

## Prerequisites

- A working Terreno backend using `TerrenoApp`
- At least one model registered with `modelRouter`

## Steps

### 1. Add an `mcp` config to a model router

```typescript
import {modelRouter, OwnerQueryFilter, Permissions} from "@terreno/api";

export const todoRouter = modelRouter("/todos", Todo, {
  mcp: {
    excludeFields: ["internalNote"],
    maxLimit: 25,
    methods: ["list", "read", "create", "update", "delete"],
  },
  permissions: {
    create: [Permissions.IsAuthenticated],
    delete: [Permissions.IsOwner],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsOwner],
    update: [Permissions.IsOwner],
  },
  queryFields: ["completed", "title"],
  queryFilter: OwnerQueryFilter,
});
```

`methods` defaults to `["list", "read"]`, and `maxLimit` defaults to 50. A method whose `permissions` array is empty is never exposed as a tool, so REST and MCP cannot drift apart.

### 2. Start the server

`TerrenoApp` mounts `POST /mcp` automatically as soon as any model has an `mcp` config. Every other verb on `/mcp` returns a JSON-RPC 405. No extra registration is needed.

Tools are named `{prefix}_{method}` — `todos_list`, `todos_read`, and so on.

The endpoint speaks the `2026-07-28` MCP revision through the TypeScript SDK v2
`createMcpHandler`. It is stateless: every request carries its protocol version,
client identity, and capabilities, so requests can land on any backend instance.
The SDK's stateless legacy fallback remains enabled, so 2025-era clients continue
to work while clients migrate.

### 3. Call the tools

Point any MCP client at `POST /mcp`. Auth order on the Bearer header is:

1. `mcp_…` service token, when `mcpServiceTokens` is enabled
2. Better Auth session
3. JWT

The resolved user is what permission checks run against, so an LLM never sees more than that user could see over REST. Mint and paste a static key with [Connect an MCP client with a service token](connect-mcp-service-token.md).

`initialize` and `tools/list` are the unauthenticated catalog. Identity is enforced on `tools/call`. GET `/mcp` is Streamable HTTP **405** (`Method not allowed.`) — there is no GET SSE stream; Perplexity still uses that 405 as a successful probe.

Authentication is required by default, matching REST. A tool call with no resolvable user is refused before any permission check unless the model router sets `allowAnonymous: true` — the same flag REST passes to `authenticateMiddleware`. That matters for read-only helpers like `IsAuthenticatedOrReadOnly`, which would otherwise pass for an anonymous `list`. Disabled accounts are refused too, as they are over HTTP. Service tokens are MCP-only: they are rejected on `/mcp/service-tokens` and are not accepted on REST, sync, or admin.

To run the same tools in-process (for example inside a chat route), use `getMCPTools`:

```typescript
import {getMCPTools} from "@terreno/ai";

const tools = getMCPTools(req.user);
```

`useMCPTools()` from `@terreno/rtk` uses the official MCP v2 client with automatic
version negotiation. It no longer constructs JSON-RPC or parses SSE responses by
hand; the SDK supplies the `2026-07-28` `_meta` envelope and required
`Mcp-Method` / `Mcp-Name` routing headers.

## Naming tools

The default prefix is the lowercase model name run through a simple pluralizer: `Todo` → `todos`, `Category` → `categories`, `Status` → `statuses`. Irregular nouns need an explicit prefix:

```typescript
mcp: {toolPrefix: "people"} // person_list -> people_list
```

## Filtering list results

Only fields listed in `queryFields` can be filtered, exactly as in REST. A filter value may be an exact value or an operator object:

```json
{"completed": false, "title": {"$in": ["Buy milk", "Walk dog"]}}
```

Allowed operators are `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$all`, `$size`, `$exists`, and `$regex` (with `$options`). Operators that can execute code or ignore indexes — `$where`, `$expr`, `$function`, `$accumulator`, `$jsonSchema`, `$text` — are rejected with an error rather than silently dropped, so the model can correct itself.

Filters can be combined with top-level `$and` / `$or`, whose branches are validated against `queryFields` too:

```json
{"$or": [{"completed": true}, {"title": {"$regex": "^Urgent"}}]}
```

`queryFilter` still runs after the filter is built, so an `OwnerQueryFilter` keeps scoping results to the calling user no matter what the LLM sends.

## Populating references

Population comes from the model router's `populatePaths`, exactly as it does over REST. A tool may pass `populate` to request a **subset** of those declared paths — it can never introduce a new one, so the `fields` allowlist on each declared path always applies and a caller cannot pull back a whole referenced document:

```typescript
populatePaths: [{fields: ["name", "email"], path: "ownerId"}],
```

`{"populate": "ownerId"}` is accepted; anything undeclared is refused with an error listing the allowed paths. Models with no `populatePaths` don't get a `populate` parameter at all.

## Hiding fields

`excludeFields` removes fields from both the generated tool schemas and the responses:

- A bare name (`"hash"`) is removed at **every depth**, including inside arrays and populated refs, so a redacted name cannot leak through a nested document.
- A dot path (`"metadata.secretKey"`) removes exactly that location, following arrays of subdocuments element-wise.

## Customizing responses

`mcpResponseHandler` shapes MCP responses independently of the REST `responseHandler`, which is useful for returning compact summaries to an LLM:

```typescript
mcp: {
  mcpResponseHandler: async (value, method) => {
    if (Array.isArray(value)) {
      return value.map((todo) => ({id: String(todo._id), title: todo.title}));
    }
    return {id: String(value._id), title: value.title};
  },
}
```

`excludeFields` is applied after your handler runs.

## Lifecycle hooks

`preCreate`, `postCreate`, `preUpdate`, `postUpdate`, `preDelete`, and `postDelete` all run for MCP calls. An MCP tool call is JSON-RPC rather than HTTP, so `createMCPRequest` builds a stub Express-shaped `request` (`MCPRequest`):

- `user` — the authenticated MCP user
- `body` — the hook-stage payload after write denylist + transform, not the raw tool args (on delete, `id` is in `body`, not `params`)
- `headers` / `query` / `params` — always `{}` (MCP does not forward HTTP headers)
- `isMCPRequest` — `true`

REST `responseHandler` gets the same stub with an empty `body`.

```typescript
import type {MCPRequest} from "@terreno/api";

preCreate: (body, req) => {
  if ((req as unknown as MCPRequest).isMCPRequest) {
    // e.g. tag records created by an assistant
    return {...body, source: "assistant"};
  }
  return body;
},
```

A hook that reads `req.headers` or `req.query` gets an empty object instead of a crash, but anything genuinely HTTP-specific (cookies, IP address) is unavailable — branch on `isMCPRequest` when that matters.

## Logging and error reporting

Every generated tool call emits a structured backend audit log with stable
`mcpTool`, `mcpMethod`, and `mcpModel` labels plus the active Terreno request
context (`requestId`, `userId`, and trace fields when present):

- successful calls log at `info` with `durationMs`
- expected refusals (permissions, not found, invalid filters) log at `warn`
- caught database, transform, and lifecycle-hook failures log at `error`

When `USE_SENTRY_LOGGING=true`, expected failures are mirrored as Sentry logs.
Unexpected exceptions and caught internal causes are also captured with
`Sentry.captureException`, preserving their original stack. The client still
receives the stable MCP error text — internal exceptions and stack traces stay
server-side. Tool arguments are not logged.

## Custom tools

CRUD tools cover one model at a time. For a query that spans models, register a custom tool with `registerMCPTool`. It shows up on `POST /mcp` and in `getMCPTools` next to the generated CRUD tools:

```typescript
import {registerMCPTool} from "@terreno/api";
import {z} from "zod";

registerMCPTool({
  name: "users_todo_statuses",
  description: "List every user with each of their todos and completed status. Admin only.",
  zodSchema: z.object({}).strict(),
  handler: async (_args, user) => {
    if (!user?.admin) {
      return {
        content: [{type: "text", text: JSON.stringify({error: "Permission denied: admin required"})}],
        isError: true,
      };
    }
    // load users + todos and return JSON text
    return {content: [{type: "text", text: JSON.stringify({users: []})}]};
  },
});
```

The example backend registers this as `users_todo_statuses` from `example-backend/src/api/usersTodoStatus.ts`.
