# Implementation Plan: modelRouter Actions

**Status:** Deferred
**Closed:** 2026-08-20 — Not pursued; custom `endpoints` callbacks remain the supported pattern for non-CRUD routes.
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1097

## Goal

Add first-class support for **actions** in `modelRouter` — URLs that perform a named operation rather than CRUD. Actions live either at `/resource/action` (collection scope) or `/resource/:id/action` (instance scope). They inherit modelRouter's permissions system, are wrapped in `asyncHandler` + the standard error envelope automatically, and appear in the generated OpenAPI spec without extra wiring.

Today, callers like `consentApp.ts` hand-roll actions inside the existing `endpoints` callback — wiring auth, error handling, doc loading, and OpenAPI manually. This plan replaces that boilerplate with a declarative API.

## Decisions

| Topic | Decision |
|---|---|
| Methods | `GET` and `POST` only. `PUT`, `PATCH`, and `DELETE` actions are intentionally unsupported in v1 to avoid confusion with CRUD and array-field update/delete routes |
| Schemas | Zod (input + output), used for both runtime validation and OpenAPI |
| Doc loading | Auto-load on instance actions; 404 if missing; pass via `ctx.doc` |
| Permissions | Same `PermissionMethod<T>[]` shape as CRUD; **required**; empty array `[]` means "disabled" (returns 405, matching CRUD semantics at `permissions.ts:90–95`); missing field throws at register time |
| Handler signature | RORO: `async ({req, res, doc, body, query, user}) => result` |
| Config shape | Top-level `instanceActions` and `collectionActions` records on `ModelRouterOptions` |
| URL casing | Action name verbatim (no kebab-case transform) |
| Response | Handler returns raw data; framework auto-wraps in `{data: ...}`. Skipped if `res.headersSent` (streaming escape hatch) |
| OpenAPI tag | Default to model tag; per-action `tag` override |
| Collisions | Throw at register time on conflicts with CRUD paths (`/`, `/:id`) or array-field operations (`/:id/:field`) |
| Hooks | No pre/post hooks on actions in v1 |
| Bulk helpers | Userland — no built-in `bulkUpdate` |

## Public API

### Types (added to `api/src/actions.ts`, re-exported from `api/src/index.ts`)

```typescript
import {z, ZodSchema} from 'zod';
import type {PermissionMethod} from './permissions';
import type {Request, Response} from 'express';

export interface ActionContext<TDoc, TBody, TQuery> {
  req: Request;
  res: Response;
  user: User | undefined;
  body: TBody;    // inferred from body schema; undefined if no schema
  query: TQuery;  // inferred from query schema; undefined if no schema
  doc: TDoc;      // only present for instance actions
}

interface BaseActionConfig<TDoc, TBody, TQuery, TResponse> {
  method: 'GET' | 'POST';
  permissions: PermissionMethod<TDoc>[];
  body?: ZodSchema<TBody>;
  query?: ZodSchema<TQuery>;
  response?: ZodSchema<TResponse>;
  summary?: string;
  description?: string;
  tag?: string;
  status?: number;  // default 200
}

export interface InstanceActionConfig<TDoc, TBody, TQuery, TResponse>
    extends BaseActionConfig<TDoc, TBody, TQuery, TResponse> {
  handler: (ctx: ActionContext<TDoc, TBody, TQuery>) =>
    TResponse | Promise<TResponse>;
}

export interface CollectionActionConfig<TBody, TQuery, TResponse>
    extends BaseActionConfig<never, TBody, TQuery, TResponse> {
  handler: (ctx: Omit<ActionContext<never, TBody, TQuery>, 'doc'>) =>
    TResponse | Promise<TResponse>;
}
```

### `ModelRouterOptions<T>` additions (in `api/src/api.ts`)

```typescript
export interface ModelRouterOptions<T> {
  // ... existing fields ...
  instanceActions?: Record<string, InstanceActionConfig<T, unknown, unknown, unknown>>;
  collectionActions?: Record<string, CollectionActionConfig<unknown, unknown, unknown>>;
}
```

### Type-preserving action factories

The `Record<string, ...<unknown, unknown, unknown>>` boundary above erases per-action generics. To let call-sites keep full inference of `body`/`query`/`response` types inside handlers, ship two const-friendly factory helpers:

```typescript
// Returns the config as-is, but with per-action generics preserved by the `const` capture.
export function defineInstanceAction<TDoc, TBody = never, TQuery = never, TResponse = unknown>(
  config: InstanceActionConfig<TDoc, TBody, TQuery, TResponse>
): InstanceActionConfig<TDoc, TBody, TQuery, TResponse> {
  return config;
}

export function defineCollectionAction<TBody = never, TQuery = never, TResponse = unknown>(
  config: CollectionActionConfig<TBody, TQuery, TResponse>
): CollectionActionConfig<TBody, TQuery, TResponse> {
  return config;
}
```

Call-site:

```typescript
import {defineInstanceAction, defineCollectionAction} from '@terreno/api';

instanceActions: {
  publish: defineInstanceAction<ScheduleDoc>({
    method: 'POST',
    permissions: [Permissions.IsOwner],
    body: z.object({notifyUsers: z.boolean()}),
    handler: async ({doc, body}) => {
      //                ^ ScheduleDoc, ^ {notifyUsers: boolean} — fully inferred
    },
  }),
}
```

The factories are zero-runtime-cost (identity functions). They're optional — bare object literals still work, just with `unknown` widening on the per-action generics.

### Call-site example

```typescript
import {z} from 'zod';
import {modelRouter, Permissions} from '@terreno/api';

export const scheduleRouter = modelRouter('/schedules', Schedule, {
  permissions: { /* CRUD perms */ },

  instanceActions: {
    status: {
      method: 'GET',
      permissions: [Permissions.IsOwner],
      response: z.object({state: z.enum(['draft', 'published'])}),
      summary: 'Get schedule status',
      handler: async ({doc}) => {
        return {state: doc.publishedAt ? 'published' : 'draft'};
      },
    },

    publish: {
      method: 'POST',
      permissions: [Permissions.IsOwner],
      body: z.object({notifyUsers: z.boolean()}),
      response: z.object({publishedAt: z.string().datetime()}),
      summary: 'Publish a schedule',
      handler: async ({doc, body}) => {
        doc.publishedAt = new Date();
        if (body.notifyUsers) await notifyUsers(doc);
        await doc.save();
        return {publishedAt: doc.publishedAt.toISOString()};
      },
    },
  },

  collectionActions: {
    bulkArchive: {
      method: 'POST',
      permissions: [Permissions.IsAdmin],
      body: z.object({ids: z.array(z.string())}),
      response: z.object({archivedCount: z.number()}),
      handler: async ({body}) => {
        const result = await Schedule.updateMany(
          {_id: {$in: body.ids}},
          {$set: {archived: true}}
        );
        return {archivedCount: result.modifiedCount};
      },
    },
  },
});
```

### Wire response

```
GET /schedules/507f.../status
→ 200 OK
{"data": {"state": "published"}}

POST /schedules/507f.../publish
→ 200 OK
{"data": {"publishedAt": "2026-05-15T18:32:11.000Z"}}
```

## Internal Mechanics

### Action name validation

Before route registration, each action name is validated against `/^[A-Za-z][A-Za-z0-9_-]+$/`. Empty names and names containing path-special characters (`*`, `:`, `/`, `(`, `)`) throw at register time with a clear message. This guards against `path-to-regexp` v6 surprises in Express 5.

### Permission method mapping

When invoking permission functions, the action passes a synthetic CRUD `method` so existing permissions like `IsAuthenticatedOrReadOnly` work:

| Scope | HTTP | `method` passed to permission |
|---|---|---|
| instance | GET | `'read'` |
| instance | POST | `'update'` |
| collection | GET | `'list'` |
| collection | POST | `'create'` |

### Action middleware chain (per registered action)

```
asyncHandler(
  authenticateMiddleware(options.allowAnonymous)   // honors parent allowAnonymous
  → runActionPermissions(action, req, undefined)   // pre-doc cheap check (matches CRUD)
  → (instance only) loadDocOr404(model, id)        // attaches req.obj
  → (instance only) runActionPermissions(action, req, req.obj)  // post-doc with-doc check
  → validateZod(body, query) if provided           // throws APIError 400 on failure
  → action.handler(ctx)                            // user code; receives parsed body/query in ctx
  → autoWrapResponse(returned, action.status, res)
)
```

`apiErrorMiddleware` already lives at the router level and converts thrown errors.

**Important compatibility points:**
- `authenticateMiddleware(options.allowAnonymous)` — must pass the parent `allowAnonymous` so anonymous-allowed routers don't 401 before permission checks run (`auth.ts:42`).
- **Two-stage permission check** mirrors `permissions.ts:135–207`. Pre-doc check throws **405** ("Method not allowed") on denial (matches CRUD `permissions.ts:136`). Post-doc check throws **403** on denial (matches CRUD `permissions.ts:203`). Empty `permissions: []` fails the pre-doc check → 405 disabled.
- Instance auto-load uses `model.findById(id)` only — **`queryFilter` is intentionally not applied** to match existing CRUD permission middleware (`permissions.ts:148`). This means action handlers may see docs that wouldn't appear in list responses; permission functions are responsible for the final check. This is an existing leak (403 confirms existence vs. 404 hides it) that the actions feature inherits. Document; don't fix in this PR.
- `req.obj` is set to the loaded doc on instance actions, matching CRUD behavior. `ctx.doc` aliases `req.obj`.

### `loadDocOr404` helper

Extracted from the existing permission middleware doc-load logic (`api/src/api.ts:148–210`). Signature:

```typescript
async function loadDocOr404<T>(
  model: Model<T>,
  id: string,
  populatePaths?: PopulatePath[]
): Promise<T>;
```

Preserves the soft-delete-aware 404 metadata behavior. Used by both the existing CRUD permission middleware (after refactor) and the new instance-action middleware.

### `runActionPermissions` helper

```typescript
async function runActionPermissions<T>(
  action: BaseActionConfig<unknown, unknown, unknown, unknown>,
  scope: 'instance' | 'collection',
  req: Request,
  doc?: T  // undefined for pre-doc check or for collection actions
): Promise<void>;
```

Maps HTTP method + scope → CRUD method (table above). Invokes each `PermissionMethod` with `(method, req.user, doc)`. **Status codes match the existing CRUD middleware exactly** (`permissions.ts:103–217`):

- Pre-doc denial (or any denial on collection actions) → **`APIError({status: 405, title: \`Access to ${METHOD} on ${model.modelName} denied for ${user?.id}\`})`** (parity with `permissions.ts:136`).
- Post-doc denial on instance actions → **`APIError({status: 403, title: \`Access to ${METHOD} on ${model.modelName}:${id} denied for ${user?.id}\`})`** (parity with `permissions.ts:203`).
- Empty `permissions: []` array → `checkPermissions` returns `false` on the pre-doc check → 405 (matches CRUD: empty array disables the method).
- 401 responses come from `apiUnauthorizedMiddleware` for passport failures, not from this helper. Tests should assert the wire envelope from that path, not synthesize it.

### Zod validation

```typescript
const parsedBody = action.body?.safeParse(req.body);
if (parsedBody && !parsedBody.success) {
  const fieldErrors = parsedBody.error.flatten().fieldErrors;
  const fields: Record<string, string> = {};
  for (const [key, msgs] of Object.entries(fieldErrors)) {
    fields[key] = (msgs as string[])[0];
  }
  throw new APIError({status: 400, title: 'Validation failed', fields});
}
const parsedQuery = action.query?.safeParse(req.query);
// (query parsing follows same pattern)

// Parsed values are passed through ctx — DO NOT reassign req.body / req.query.
// Express 5 makes req.query a getter; assignment throws.
ctx.body = parsedBody?.data;
ctx.query = parsedQuery?.data;
```

**Wire shape of validation errors:** `APIError.fields` is folded into `meta.fields` by `errors.ts:117–121` and emitted as `{status: 400, title: "Validation failed", meta: {fields: {...}}}` (not `{..., fields: {...}}`). Tests and frontends consume `meta.fields`. This matches existing CRUD validation errors.

**Zod object parsing strategy:** Zod 4 `.object()` defaults to **strip** (silently drops unknown fields). For actions we use `safeParse` against the user's schema as-is — the user can opt into `.strict()` to reject unknown fields. Document the default in the explainer.

### Auto-wrap response

```typescript
const result = await action.handler(ctx);
if (res.headersSent) return; // handler streamed
res.status(action.status ?? 200).json({data: result ?? null});
```

Matches the **read/update/delete** CRUD envelope (`{data: ...}`). It deliberately does **not** match:

- **List shape** (`{data, limit, more, page, total}` at `api.ts:761–767`) — list-style pagination is the user's responsibility. If a collection action wants paginated output, the handler builds the envelope itself and calls `res.json(...)`, then returns; the `headersSent` check skips the auto-wrap.
- **Create status 201** (`api.ts:615`) — actions default to **200**. Users who want 201 set `status: 201` on the action config.

Streaming handlers must complete the response (write headers via `res.json`/`res.end`) before returning so `res.headersSent` is true on the check.

### Collision detection (register time)

Before routes register, walk both action maps and validate:

1. Empty action name → `Error("Action name cannot be empty")`.
2. Action name matches a Mongoose schema array field path → `Error("instanceAction 'tags' collides with array field operations on /:id/tags")`.
3. Action name is one of the reserved CRUD path segments (`""`, none for `:id` since the param is positional — but action paths like `id` are fine).
4. Duplicate names across `instanceActions` and `collectionActions` are allowed (different scopes, different paths).

Throw synchronously so app boot fails loudly.

### OpenAPI emission

**Emission must work under both `TerrenoApp` (which calls `_buildWithOpenApi`) and legacy `setupServer` (which never calls `_buildWithOpenApi`; `expressServer.ts:257`).** Therefore action OpenAPI registration uses the **same per-request middleware pattern as CRUD** (`openApi.ts:138–326`): a middleware factory captures the action config + Zod schemas at register time and emits the operation via `oapi.path()` on first request through that route.

```typescript
// Composed into the action middleware chain at register time:
const actionOpenApiMiddleware = createActionOpenApiMiddleware({
  action,
  model,
  scope,            // 'instance' | 'collection'
  actionName,
  tag: action.tag,  // defaults to model.collection.collectionName
});
```

Inside the middleware, the first request through the route calls `oapi.path(operationObject)` with an Operation Object built from:
- method/path/tag/summary/description/status
- `operationId: '${tag}_${actionName}'` so RTK Query Code Generation produces stable, deterministic hook names
- `parameters` containing `id` for instance actions
- `requestBody`/`responses` whose `schema` is the inlined JSON-Schema fragment from `@asteasolutions/zod-to-openapi`'s `OpenApiGeneratorV3.generateSchema()` (no global registry — every schema is inlined, so no cross-router component-name collisions)

**Dependency pinning:** `@asteasolutions/zod-to-openapi` MUST be pinned to **`^8.5.0`** (the first major with `peerDependencies: {zod: "^4.0.0"}`). Earlier majors pin to Zod 3 and break against the codebase's `zod ^4.3.6`.

**Double-build interaction:** `api.ts:495` shows `_buildWithOpenApi` re-invokes `_buildModelRouter`, which re-invokes `options.endpoints` — so action route registration also happens twice for `TerrenoApp` consumers (once with `openApi: undefined`, once with `openApi: <real>`). This is fine because each invocation gets a fresh `express.Router()`, and the OpenAPI middleware no-ops when `options.openApi` is undefined. `assertNoActionCollisions` runs synchronously inside the constructor and is also idempotent (just throws or doesn't).

## Files to Create / Modify

| File | Action | Why |
|---|---|---|
| `api/src/actions.ts` | **create** | Public types (`ActionContext`, `InstanceActionConfig`, `CollectionActionConfig`) + helpers (`runActionPermissions`, `validateActionRequest`, `wrapActionResponse`, `registerActionRoutes`, `createActionOpenApiMiddleware`, `assertNoActionCollisions`) |
| `api/src/docLoader.ts` | **create** | `loadDocOr404(model, id, populatePaths?)` helper, extracted from existing permission middleware. Neutral module to avoid `actions.ts` ↔ `permissions.ts` circular import |
| `api/src/permissions.ts` | modify | Refactor `permissionMiddleware` to call `loadDocOr404` (behavior-preserving; soft-delete metadata + 404 fallback intact) |
| `api/src/api.ts` | modify | Extend `ModelRouterOptions<T>` with `instanceActions`/`collectionActions`; call `assertNoActionCollisions` + `registerActionRoutes` in the pre-CRUD endpoints slot. No new `_buildWithOpenApi` work — action OpenAPI emits via per-request middleware composed into the action chain |
| `api/src/index.ts` | modify | Re-export `ActionContext`, `InstanceActionConfig`, `CollectionActionConfig` |
| `api/package.json` | modify | Add `zod ^4.3.6` as a **peerDependency** (matching `example-backend`'s installed version) plus `^4.3.6` in `devDependencies` for compile + tests. Add `@asteasolutions/zod-to-openapi ^8.5.0` as a regular `dependency` (it bundles its own usage). Bump `@terreno/api` version |
| `api/src/consentApp.ts` | modify | Migrate the three `/consent-forms` `endpoints` actions (`generate`, `translate` — both conditional on `aiConfig`; `/:id/publish`). The `/consents/*` routes (`consentApp.ts:195–457`) are out of scope — they aren't on a `modelRouter` |
| `api/src/actions.test.ts` | **create** | Unit + integration tests (see test plan) |
| `example-backend/src/api/todos.ts` | modify | Add an instance action (`markComplete`) and a collection action (`bulkComplete`) to dogfood + demonstrate |
| `example-frontend/store/openApiSdk.ts` | regenerate | Via `bun run sdk` after backend changes |
| `docs/explanation/model-router-actions.md` | **create** | User-facing docs page |
| `mcp-server/src/tools.ts` or `prompts.ts` | modify (if applicable) | Add `actions` to `generate_route` so AI assistants suggest the new API |

## Phasing

### Phase 1 — Foundation (types + runtime + per-route OpenAPI middleware)

1. Add `zod ^4.3.6` and `@asteasolutions/zod-to-openapi ^8.5.0` to `api/package.json`. If a Bun catalog version of Zod exists, use it.
2. Create `api/src/docLoader.ts` exporting `loadDocOr404(model, id, populatePaths?)`. Refactor `permissionMiddleware` in `api/src/permissions.ts` to call it. Behavior-preserving — added test asserts soft-delete 404 metadata is intact.
3. Create `api/src/actions.ts` with public types and helpers, including the per-route `createActionOpenApiMiddleware` factory (no-ops when `options.openApi` is undefined; emits via `oapi.path()` on first request when present).
4. Extend `ModelRouterOptions<T>` types in `api/src/api.ts`.
5. Wire `assertNoActionCollisions` + `registerActionRoutes` into modelRouter, registered in the pre-CRUD `endpoints` slot. Action middleware chain composes: `authenticateMiddleware(options.allowAnonymous)` → pre-doc `runActionPermissions` → (instance) `loadDocOr404` → (instance) post-doc `runActionPermissions` → `validateActionRequest` → `action.handler` → `wrapActionResponse`. The `actionOpenApiMiddleware` runs alongside the chain for spec emission.
6. Unit tests cover: types compile; instance + collection happy path (GET + POST); pre-doc perm denied → 405 (with title matching CRUD's "Method not allowed"); post-doc perm denied → 403; 401 path comes from `apiUnauthorizedMiddleware`; doc not found → 404 with soft-delete metadata; validation error → 400 with `meta.fields`; collision detection at register time; action-name regex; empty-array `permissions: []` → 405; auto-wrap shape; `res.headersSent` escape hatch.

### Phase 2 — OpenAPI verification

Per-action OpenAPI emission is part of Phase 1's middleware chain; this phase verifies the emitted spec.

1. Tests against the generated `openapi.json`: contains action operations under `paths`; method + path correct; default tag = `model.collection.collectionName`; `tag` override honored; `requestBody.content."application/json".schema` is the Zod-derived JSON Schema (inlined); `responses[status].content."application/json".schema` likewise; instance paths include the `id` path parameter; collection paths do not; deterministic `operationId: '${tag}_${actionName}'`.
2. Verify both code paths emit: `TerrenoApp` (via `_buildWithOpenApi` rebuild) **and** legacy `setupServer` (per-request middleware fires on first hit). Add a test asserting parity between the two paths.

### Phase 3 — Migration + dogfooding

1. Migrate `consentApp.ts` `/consent-forms` endpoint actions to the new API:
   - `generate` → `collectionActions.generate` (constructed conditionally on `aiConfig`).
   - `translate` → `collectionActions.translate` (same conditional).
   - `/:id/publish` → `instanceActions.publish`.
   - Leave `/consents/*` routes (`consentApp.ts:195–457`) unchanged — not on a `modelRouter`.
2. Confirm existing consent-form tests pass without modification.
3. Add a `markComplete` instance action and `bulkComplete` collection action to `example-backend/src/api/todos.ts`.
4. Regenerate `example-frontend` SDK: `cd example-frontend && bun run sdk`.
5. Smoke-test full stack: `bun run backend:dev` + `bun run frontend:web`; exercise both new todo actions via curl + regenerated hooks.

### Phase 4 — Consumer compile-check + docs

1. Verify all in-repo consumers of `@terreno/api` compile and test cleanly under the new deps: `admin-backend`, `admin-frontend`, `ai`, `api-health`, `feature-flags`, `mcp-server`, `rtk`, `example-backend`. Run `bun run compile` (and `bun run test` where present) per package.
2. Decide and document whether `zod` is a `dependency` or `peerDependency` of `@terreno/api`. Default: hard `dependency` (matches `mongoose-to-swagger` etc.).
3. Write `docs/explanation/model-router-actions.md` with the call-site example, semantics (permission status codes, response envelope, validation wire shape, collision detection, Zod `.strict()` recommendation), and migration notes from hand-rolled `endpoints` actions.
4. Update `mcp-server/src/tools.ts` `generate_route` to suggest `instanceActions`/`collectionActions`.
5. Bump `@terreno/api` version and prepare changelog entry mentioning the new feature, the new deps, and the behavior-preserving permission middleware refactor.

## Test Plan

All tests in `api/src/actions.test.ts` using the existing pattern (`getBaseServer`, `authAsUser`, `setupDb`, `supertest`).

### Registration

- Throws when `permissions` missing.
- Throws when `permissions` is an empty array.
- Throws when an action name collides with an array-field operation.
- Throws on empty action name.
- Does not throw on instance + collection actions sharing a name.

### Routing & permissions

- `POST /resource/:id/action` invokes handler with loaded `doc` and `req.obj` set.
- `POST /resource/action` invokes handler with no `doc`.
- `GET` actions work for both scopes.
- `404` when instance action id doesn't exist (and reflects soft-delete metadata, matching CRUD).
- `401` when unauthenticated and `IsAuthenticated` in permissions — coming from `apiUnauthorizedMiddleware`, with the existing 401 wire shape (not from a synthesized APIError).
- Pre-doc perm denial → **405** with title `Access to <METHOD> on <Model> denied for <userId>` (matches `permissions.ts:136`).
- Post-doc perm denial → **403** with title `Access to <METHOD> on <Model>:<id> denied for <userId>` (matches `permissions.ts:203`).
- Empty `permissions: []` → **405** (method disabled), matching CRUD.
- `IsAuthenticatedOrReadOnly` passes for GET actions even when `allowAnonymous: true` and no auth header (validates the method mapping AND that `authenticateMiddleware(options.allowAnonymous)` is honoured).
- `IsOwner` works on instance actions (validates the two-phase permission flow: pre-doc returns true when `obj` is undefined; post-doc checks `ownerId`).

### Validation

- Valid body parses through and reaches handler via `ctx.body`.
- Invalid body → 400 with `meta.fields` populated (per `errors.ts:117–121` wire shape).
- Body parsing coerces (Zod-style) — `z.coerce.number()` transforms `"5"` to `5` in `ctx.body`.
- Query schema validates query params; parsed result in `ctx.query`. `req.query` is NOT reassigned (Express 5 getter).
- Missing body when schema requires → 400.
- Default `.strip` behavior of Zod objects — unknown fields silently dropped from `ctx.body`. Tests assert this and the explainer doc recommends `.strict()`.

### Response shape

- Handler return value wrapped in `{data: ...}` (matches read/update/delete CRUD envelope).
- `status` option respected (e.g. 202).
- `null`/`undefined` return → `{data: null}`.
- Headers-sent escape hatch: handler that calls `res.json` directly is not re-wrapped.
- Test asserting list-style envelope is **user's responsibility** (collection action that calls `res.json({data, total, more, ...})` then returns is not re-wrapped).

### OpenAPI

- Generated spec contains operations for each registered action.
- Default tag = model collection name; `tag` override applied when set.
- Request body schema converted from Zod and included in operation.
- Response schema included under the configured status code.
- Path parameters present for instance actions (`{id}`).

### Migration

- Existing `consentApp.ts` tests pass against migrated code.

## Acceptance Criteria

Each criterion is independently testable. Most are exercised by the bun-test suite in `api/src/actions.test.ts`; smoke criteria are exercised manually against `example-backend` + `example-frontend`.

### AC1 — Instance action happy path (POST)

**Given** a modelRouter with `instanceActions: {publish: {method: 'POST', permissions: [IsOwner], body: z.object({notify: z.boolean()}), response: z.object({ok: z.boolean()}), handler}}`
**When** an owner POSTs `{notify: true}` to `/resource/{validId}/publish`
**Then** the handler receives `ctx.doc` (the loaded document), `ctx.body.notify === true`, `ctx.user` is set; response is `200 {data: {ok: true}}`.

### AC2 — Collection action happy path (POST)

**Given** a modelRouter with `collectionActions: {bulkArchive: {method: 'POST', permissions: [IsAdmin], body, handler}}`
**When** an admin POSTs a valid body to `/resource/bulkArchive`
**Then** the handler receives `ctx.body` parsed and `ctx.doc` is `undefined`; response is `200 {data: <handler return>}`.

### AC3 — GET actions

**Given** an instance action with `method: 'GET'` and a `query` schema
**When** a permitted user GETs `/resource/{id}/actionName?x=1`
**Then** `ctx.query` is parsed and passed; response is wrapped in `{data: ...}`.

### AC4 — Auth required → 401

**Given** an action with `permissions: [IsAuthenticated]`
**When** an unauthenticated request hits the action URL
**Then** response is `401` with the existing unauthorized wire shape from `apiUnauthorizedMiddleware` (`errors.ts:208–219`).

### AC5 — Permission denied: pre-doc → 405, post-doc → 403

**Given** an instance action with `permissions: [IsOwner]` and a non-owner authenticated user
**When** they POST to the action
**Then** the request reaches the post-doc permission check (since `IsOwner` returns `true` when `obj` is undefined). The post-doc check fails on `ownerId` mismatch and response is **403** with title `Access to UPDATE on <Model>:<id> denied for <userId>`.

**Given** a collection action with `permissions: [IsAdmin]` and a non-admin authenticated user
**When** they POST to the action
**Then** response is **405** with title `Access to CREATE on <Model> denied for <userId>` (pre-doc denial, matching `permissions.ts:136`).

### AC6 — `IsAuthenticatedOrReadOnly` mapping

**Given** an action with `permissions: [IsAuthenticatedOrReadOnly]` and `method: 'GET'`
**When** an unauthenticated user GETs it
**Then** request succeeds (validates that the method mapping treats GET actions as `'read'` / `'list'`).

### AC7 — Instance doc not found → 404

**Given** any instance action
**When** a request hits `/resource/{nonexistentId}/action`
**Then** response is `404` with the existing `APIError` shape (matching the CRUD GET-by-id 404 metadata behavior for soft-deleted documents).

### AC8 — Validation error → 400 with field-level errors

**Given** an action with `body: z.object({email: z.string().email()})`
**When** a request sends `{email: "not-an-email"}`
**Then** response is `400` with `title === "Validation failed"` and the body contains `meta.fields.email` populated with the Zod error message (per `errors.ts:117–121` wire shape — `fields` is folded into `meta.fields`).

### AC9 — Coercion via Zod

**Given** an action with `body: z.object({count: z.coerce.number()})` and request body `{count: "5"}`
**Then** handler receives `ctx.body.count === 5` (parsed value passed via `ctx`, NOT via mutating `req.body`).

### AC10 — Response envelope

**Given** an action handler that returns `{x: 1}`
**Then** the HTTP response body is exactly `{"data": {"x": 1}}` and HTTP status defaults to `200`.

### AC11 — Custom status code

**Given** an action with `status: 202` returning `{queued: true}`
**Then** the HTTP response status is `202` and body is `{"data": {"queued": true}}`.

### AC12 — Null return

**Given** an action handler that returns `undefined`
**Then** the response body is `{"data": null}`.

### AC13 — Streaming escape hatch

**Given** an action handler that calls `res.json({custom: 1})` then returns
**Then** the response body is `{"custom": 1}` (not re-wrapped); no exception thrown.

### AC14 — Missing permissions throws at register time; empty array disables

**Given** an action config with `permissions` **omitted entirely**
**When** modelRouter is constructed
**Then** an `Error` is thrown synchronously with a clear message naming the offending action.

**Given** an action config with `permissions: []`
**When** modelRouter is constructed
**Then** no error is thrown at register time — the action is registered but every request to it returns **405** (pre-doc check fails because `checkPermissions` returns false for empty arrays per `permissions.ts:90–95`). This matches CRUD "method disabled" semantics.

### AC14b — Action name validation

**Given** an action keyed under `"foo*bar"` or `"foo:bar"` or `"foo/bar"`
**When** modelRouter is constructed
**Then** an `Error` is thrown naming the invalid name and the regex it must match (`/^[A-Za-z][A-Za-z0-9_-]+$/`).

### AC15 — Collision detection

**Given** an instance action named `tags` on a model with a `tags` array field
**When** modelRouter is constructed
**Then** an `Error` is thrown naming the collision (`/:id/tags`).

### AC16 — Empty action name rejected

**Given** an action keyed under `""`
**Then** modelRouter construction throws.

### AC17 — OpenAPI: operation appears under BOTH TerrenoApp and setupServer

**Given** an action registered as above
**When** the generated `openapi.json` is fetched (after at least one request through the action route, since OpenAPI emission is on-first-request middleware)
**Then** the spec contains an operation at the correct path + method with the action's `summary` (or default), `description`, `tag` (default = model collection name), `requestBody` schema (from Zod, inlined), `responses[status].content.application/json.schema` (inlined Zod-derived), and `operationId: '${tag}_${actionName}'`. This must hold both for routers registered via `TerrenoApp.register(...)` and via `setupServer({addRoutes})` paths.

### AC18 — OpenAPI: tag override

**Given** an action with `tag: 'Custom Tag'`
**Then** the OpenAPI operation lists `tags: ['Custom Tag']`.

### AC19 — OpenAPI: path parameter present for instance actions

**Given** any instance action
**Then** its OpenAPI operation lists a path parameter `id` (string).

### AC19b — OpenAPI: deterministic operationId

**Given** an action named `publish` on a model with tag `schedules`
**Then** the operation's `operationId` is `schedules_publish` — guaranteeing RTK Query Code Generation produces a stable hook name.

### AC20 — `consentApp.ts` migration behaviour-preserving

**Given** the consent forms test suite
**When** `consentApp.ts` is migrated to the new actions API
**Then** all existing tests pass without modification.

### AC21 — Example backend exposes new actions

**Given** `example-backend/src/api/todos.ts` declares `markComplete` and `bulkComplete` actions
**When** the backend is started and the OpenAPI spec is fetched
**Then** both operations appear under the Todos tag with correct paths/methods.

### AC22 — Example frontend SDK regeneration

**Given** the regenerated `example-frontend/store/openApiSdk.ts`
**Then** typed hooks for both new actions exist and compile.

### AC23 — Test suite passes

**Given** `bun run test` in `api/`
**Then** all tests pass (including new `actions.test.ts` and existing consent + modelRouter suites).

### AC24 — Type checking

**Given** `bun run compile` in every `@terreno/api` consumer (`api`, `admin-backend`, `admin-frontend`, `ai`, `api-health`, `feature-flags`, `mcp-server`, `rtk`, `example-backend`, `example-frontend`)
**Then** all compilations succeed.

### AC25 — No regression in `endpoints` callback

**Given** an existing modelRouter using `endpoints: (router) => { router.get('/custom', handler) }`
**Then** the custom route still works unchanged after this PR (the action system is additive).

### AC26 — `allowAnonymous` propagation

**Given** `modelRouter(Model, {allowAnonymous: true, instanceActions: {foo: {method: 'GET', permissions: [IsAuthenticatedOrReadOnly], handler}}})`
**When** an unauthenticated request hits `/{id}/foo`
**Then** the request succeeds (no 401). Validates that `authenticateMiddleware(options.allowAnonymous)` is honoured.

### AC27 — Co-registration precedence

**Given** a modelRouter with `instanceActions: {foo: {...}}` **and** `endpoints: (router) => { router.get('/:id/foo', handler) }`
**When** a request hits `/:id/foo`
**Then** the action handler runs (actions register first in the pre-CRUD slot, before user `options.endpoints`).

### AC28 — Type-preserving factories

**Given** a call-site using `defineInstanceAction<ScheduleDoc>({body: z.object({x: z.string()}), handler: async ({doc, body}) => { /* ... */ }})`
**Then** `tsc --noEmit` confirms `doc: ScheduleDoc` and `body: {x: string}` (per-action generics preserved across the `Record<string, ...>` boundary).

## Risks & Open Items

| # | Risk / Item | Mitigation |
|---|---|---|
| 1 | Adding `zod` + `zod-to-openapi` to `@terreno/api` is a new direction (today's validation is AJV/JSON-schema). | Action validation is parallel, not replacing AJV. Coexists. Pin `@asteasolutions/zod-to-openapi ^8.5.0` so the Zod 4 peer-dep is satisfied. |
| 2 | `loadDocOr404` extraction touches the hot permission middleware path. | Extract to a neutral `api/src/docLoader.ts` module to avoid circular imports. Refactor must be behavior-preserving — added test asserting current 404 metadata behavior. |
| 3 | TypeScript inference across `Record<string, InstanceActionConfig<T, unknown, unknown, unknown>>` loses per-action body/query/response types at the record boundary. | Ship `defineInstanceAction()` / `defineCollectionAction()` identity helpers that preserve per-action generics (`TBody`, `TQuery`, `TResponse`) for full handler-side inference. Bare object literals still work, just with `unknown` widening. |
| 4 | `IsAuthenticatedOrReadOnly` on collection POST → mapped to `'create'`, denies anon access. | Cover in test + docs. |
| 5 | Generated SDK changes — frontends consuming `@terreno/rtk` will see new endpoints with deterministic `operationId`-based hook names. | Expected. Standard SDK regeneration step in Phase 3. `operationId: '${tag}_${actionName}'` ensures stable names. |
| 6 | Existing `endpoints` callers might want to migrate piecemeal — both APIs need to coexist. | They do: actions sit on top of the `endpoints` slot internally. Document `endpoints` as the escape hatch. AC25 explicitly tests this. |
| 7 | `_buildModelRouter` runs twice for `TerrenoApp` registrations (`api.ts:495`). Action registration + OpenAPI middleware fire twice. | Idempotent: each call gets a fresh router; OpenAPI middleware no-ops when `options.openApi` is undefined (first call) and emits when defined (second call). Documented in "Internal Mechanics → Double-build interaction." |
| 8 | Instance action auto-load uses `findById` and bypasses `queryFilter` (matches existing CRUD permission middleware at `permissions.ts:148`). Reveals doc existence via 403 vs 404. | Pre-existing leak inherited unchanged. Document. Out of scope to fix. |
| 9 | Concurrent action handlers loading the same doc + `doc.save()` → `VersionError` → 500. | Existing CRUD limitation (see `api.ts:1118–1130`). Document in explainer: "actions are not transactional; for concurrent writes prefer `findOneAndUpdate`." |
| 10 | Express 5 makes `req.query` getter-only. Plan avoids mutating it; parsed body/query is passed via `ctx`. | Tests assert `ctx.query` carries parsed value while `req.query` is untouched. |
| 11 | Zod 4 `.object()` defaults to `.strip` — unknown fields silently dropped. | Document and recommend `.strict()` in the explainer. AC test asserts default `.strip` behavior so users aren't surprised. |

## Out of Scope

- Pre/post hooks on actions (deferred until a clear pattern emerges).
- Built-in bulk helpers (`bulkUpdate`, `bulkDelete`) — userland for now.
- Automatic kebab-case URL transformation.
- Action permissions inheritance from the model's CRUD permissions.
- Webhook / async actions.
- Per-action rate limiting.
