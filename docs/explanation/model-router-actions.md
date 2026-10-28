# modelRouter actions

`modelRouter` can register **actions** — named operations at collection or instance scope — alongside standard CRUD. Actions reuse the same permission model, error envelope, and OpenAPI pipeline as CRUD routes, without hand-wiring `endpoints`, `asyncHandler`, and doc loading.

CRUD **create, update, and delete** (not named actions) share one write pipeline: REST, Sync, and MCP all call `executeCreate` / `executeUpdate` / `executeDelete` in `api/src/sync/executors.ts`. MCP tools map arguments and `APIError` titles onto the MCP result envelope after the executor returns. RBAC User-role stripping runs in those executors **after** `transform` / `preCreate` / `preUpdate`. Stripping applies to the user model: a model compiled as `"User"`, or the `userModel` passed to `createAccess` under whatever name it was compiled. Pass `userModel` to `createAccess` when your user model has another name. Invalid document `_id` values (`CastError` on path `_id`, BSON invalid ObjectId) load as 404 `Document not found`; `CastError` on populate paths is a GET error, not a missing document.

## When to use actions

Use `collectionActions` / `instanceActions` for every application GET or POST that is not
plain document CRUD. Do **not** register `app.get`, `app.post`, `router.get`, or
`router.post` for those endpoints.

Use actions when an endpoint performs an operation that is not a plain create/read/update/delete on the model document:

- **Collection scope** (`POST /todos/bulkComplete`) — operate on many documents or the collection as a whole.
- **Instance scope** (`POST /todos/:id/markComplete`) — operate on one loaded document.

Leave Express `app.get` / `app.post` only for:

- Inbound webhooks (`WebhooksApp`)
- Static SPA / file serving
- Framework auth, health, and version-check plugins
- SSE or other streaming handlers that write the response themselves
- Tests and harnesses

PATCH and DELETE are CRUD (or a POST action that performs the same work). Do not add a
hand-rolled DELETE next to a modelRouter.

Use [custom routes with `createOpenApiBuilder`](./modular-api-design.md) only when the
URL cannot be `/{actionName}` or `/:id/{actionName}` **and** the exceptions above do not
apply.

## Example

```typescript
import {modelRouter, Permissions, z} from "@terreno/api";
import {Todo} from "../models/todo";

export const todoRouter = modelRouter("/todos", Todo, {
  permissions: {
    create: [Permissions.IsAuthenticated],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsOwner],
    update: [Permissions.IsOwner],
    delete: [Permissions.IsOwner],
  },
  instanceActions: {
    markComplete: {
      method: "POST",
      permissions: [Permissions.IsOwner],
      handler: async ({doc}) => {
        doc.completed = true;
        await doc.save();
        return doc;
      },
      summary: "Mark a todo complete",
    },
  },
  collectionActions: {
    bulkComplete: {
      method: "POST",
      permissions: [Permissions.IsAuthenticated],
      body: z.object({ids: z.array(z.string()).min(1)}).strict(),
      response: z.object({matched: z.number(), modified: z.number()}).strict(),
      handler: async ({body, user}) => {
        // updateMany using body.ids and user._id
      },
      summary: "Mark multiple todos complete",
    },
  },
});
```

Use `.strict()` on Zod object schemas when you want unknown JSON keys rejected at runtime. Zod’s default object behavior strips unknown keys.

## Handler context

Handlers receive a single context object:

| Field | Instance | Collection |
|-------|----------|------------|
| `req`, `res`, `user` | yes | yes |
| `doc` | loaded document | — |
| `body` | parsed body (see below) | parsed body |
| `query` | parsed query | parsed query |

Return a plain value from the handler; the framework responds with `{data: <value>}` and status `200` (or `action.status` if set). If the handler writes the response itself (`res.json`, streaming), return without relying on auto-wrap — the framework skips wrapping when `res.headersSent` is true.

Set `unwrapResponse: true` to send the return value itself as the body, with `action.status`, instead of `{data: <value>}`. An `undefined` return sends an empty body (useful with `status: 204`). Use it when converting an existing `router.post` route whose clients expect the bare shape. OpenAPI documents the `response` schema without the `data` wrapper for these actions. `unwrapResponse` affects REST only; MCP always returns the value as the tool's JSON text.

## Permissions

Each action requires a non-empty `permissions` array (same `PermissionMethod` types as CRUD). An empty array disables the action and returns **405**, matching CRUD.

HTTP method and scope map to a CRUD permission check:

| Scope | GET | POST |
|-------|-----|------|
| Instance | `read` | `update` |
| Collection | `list` | `create` |

**405** — denied before a document is loaded (or on any collection action denial).  
**403** — denied after the instance document is loaded (e.g. `IsOwner` with a document that fails the check).  
**401** — unauthenticated when a permission requires auth (from existing auth middleware).

With RBAC `access` on the router, an action without its own `access` inherits the router's resource and the mapped CRUD action. When the action's resource (inherited or set with `access`) matches the router's resource, the router's `access.scope` check and `access.also[method]` permissions also run, before and after the document loads, exactly as they do for the mapped CRUD method. A user whose role grants `todo:update` but who fails the router scope for a document gets **403** on that document's instance actions, the same as on `PATCH`. An action whose `access` names another resource skips the router's `scope` and `also`.

`authenticateMiddleware` honors the router’s `allowAnonymous` option, same as CRUD. An action may set `allowAnonymous: true` to accept unauthenticated requests without making the router's CRUD routes or other actions anonymous. Keep a non-empty permission such as `Permissions.IsAny` and authenticate any service token in the handler.

## Validation

Optional `body` and `query` Zod schemas validate input. On failure the API returns **400** with `title: "Validation failed"` and field errors in `meta.fields`.

Parsed values are passed only through `ctx.body` / `ctx.query`. Express 5 does not allow reassigning `req.query`; do not mutate `req.body` in middleware.

When no `body` or `query` schema is configured, the raw `req.body` / `req.query` are passed through (for manual validation in the handler).

## Document loading (instance actions)

Instance actions load the document by `id` before the handler runs. Missing documents return **404**, including soft-delete metadata when applicable.

`queryFilter` is **not** applied to this load (same as CRUD permission middleware). List filters may hide a document that still exists; post-load permission checks are responsible for access control.

`req.obj` is set to the loaded document for parity with CRUD update/delete handlers.

## OpenAPI and SDK codegen

When `openApi` is configured on the router (automatic with `TerrenoApp` and `setupServer`), each action is documented on first route registration. Operations use:

- **Tag** — model collection name by default; override with `action.tag`.
- **operationId** — `{tag}_{actionName}` (e.g. `todos_markComplete`) for stable generated hook names (`store/apiSdk.ts`) after SDK regeneration.

Request/response schemas are derived from Zod when `body`, `query`, or `response` are set. Successful responses are documented as `{data: ...}` to match the wire format.

## MCP tools

Set `mcp: {name, description?}` on an action to also expose it as an MCP tool on `/mcp`, so a frontend calling the action over REST and an agent calling it over MCP share one implementation:

```typescript
instanceActions: {
  promote: {
    body: z.object({note: z.string().optional()}).strict(),
    handler: async ({body, doc}) => promoteDraft(doc, body.note),
    mcp: {description: "Promote a draft to published", name: "drafts_promote"},
    method: "POST",
    permissions: [Permissions.IsOwner],
  },
},
```

The tool behaves like the REST route:

- **Input.** An instance action takes `{id, ...body}` (POST) or `{id, ...query}` (GET). A collection action takes the body or query alone. `body` / `query` must be a `z.object()`, and an instance action's schema cannot define `id` (a collection action's can, and gets it). With no schema, the tool accepts any arguments, as REST forwards the raw body.
- **Validation.** The MCP server validates arguments against that schema before the handler runs, so the handler gets the same parsed `ctx.body` / `ctx.query` as REST.
- **Permissions.** The same `runActionPermissions` chain runs before and after the document loads, including RBAC `access`. It never falls back to the router's CRUD permissions. A refused call returns an `isError` result with the error title (`Access denied`), where REST returns 403 or 405.
- **Authentication.** A call without a user is refused unless the action or router sets `allowAnonymous`.
- **Handler.** `req` comes from `createMCPRequest` (`req.isMCPRequest === true`, `req.params.id` set for instance actions). `res` throws `Action used res during an MCP call` when touched, so an action that writes to `res` directly cannot opt in.
- **Result.** The return value becomes the tool's JSON text. A thrown `APIError` becomes an `isError` result with its title; validation errors add their field messages.

Action tools are collected from every registered router when `/mcp` mounts, alongside CRUD and `registerMCPTool` tools. A disabled action (`permissions: []`) is not exposed. Tool names must be unique across all tools; a collision fails at boot.

## Collision detection

At router build time, Terreno rejects:

- Empty action names or names that do not match `/^[A-Za-z][A-Za-z0-9_-]+$/`
- Instance action names that match a Mongoose array field path (which would collide with `POST /:id/:field` array routes)

Actions are registered before user `endpoints` callbacks, so they take precedence if paths overlap.

## Migrating from `endpoints`

Before (hand-rolled):

```typescript
endpoints: (router) => {
  router.post("/generate", [authenticateMiddleware()], asyncHandler(async (req, res) => {
    // manual admin check, validation, OpenAPI omitted
    return res.json({data: result});
  }));
},
```

After:

```typescript
collectionActions: {
  generate: {
    method: "POST",
    permissions: [Permissions.IsAuthenticated],
    handler: async ({body, user}) => { /* ... */ return result; },
  },
},
```

Remove duplicate `asyncHandler`, `authenticateMiddleware`, and manual `{data: ...}` wrapping unless you need a custom response shape.

## Dependencies

`@terreno/api` lists **`zod` as a peer dependency** (^4.3.x). Applications that define action schemas must install `zod` in the backend project. Import `z` from `@terreno/api` (re-exported after OpenAPI extension) so action Zod schemas work with automatic OpenAPI generation.

`@asteasolutions/zod-to-openapi` is bundled with `@terreno/api` for OpenAPI schema generation.

## Concurrency

Action handlers run the same as other Express handlers — no transactions or locking. Use application-level guards (version fields, idempotency keys) if you need to prevent double-submit races.
