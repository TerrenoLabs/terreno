# modelRouter Actions — Task List

**Status:** Closed (2026-08-20) — IP deferred. Open tasks below will not be executed.

## Phase 1: Foundation (types + runtime + per-route OpenAPI middleware)

- [ ] **Task 1.1**: Add `zod ^4.3.6` as a **peerDependency** of `@terreno/api` (also pin `^4.3.6` in `devDependencies` so the package compiles/tests on its own) and `@asteasolutions/zod-to-openapi ^8.5.0` as a regular `dependency` (it bundles its own usage). Use Bun catalog for Zod if a catalog version exists.
- [ ] **Task 1.2**: Create `api/src/docLoader.ts` exporting `loadDocOr404(model, id, populatePaths?)`. Behavior matches the existing permission middleware doc-load (`permissions.ts:148–200`): 404 on missing, soft-delete-aware metadata via `model.collection.findOne` fallback.
- [ ] **Task 1.3**: Refactor `permissionMiddleware` in `api/src/permissions.ts` to call `loadDocOr404`. Add a regression test asserting soft-delete 404 metadata is intact. No public API change.
- [ ] **Task 1.4**: Create `api/src/actions.ts` with public types: `ActionContext`, `BaseActionConfig`, `InstanceActionConfig`, `CollectionActionConfig`. Also export `defineInstanceAction()` and `defineCollectionAction()` identity helpers that preserve per-action generics across the `Record<string, ...>` boundary.
- [ ] **Task 1.5**: Implement `runActionPermissions(action, scope, req, doc?)` in `api/src/actions.ts`. Maps HTTP method + scope → CRUD method. Pre-doc denial → **405** (matches `permissions.ts:136`). Post-doc denial → **403** (matches `permissions.ts:203`). Uses existing `checkPermissions` helper so `[]` arrays disable the action via 405.
- [ ] **Task 1.6**: Implement `validateActionRequest(action, req)` in `api/src/actions.ts`. Runs Zod `safeParse` on body/query when schemas provided. On failure throws `APIError({status: 400, title: "Validation failed", fields})` — emitted as `meta.fields` on the wire by `errors.ts:117–121`. Parsed values returned through `ctx`, NOT by mutating `req.query` (Express 5 getter).
- [ ] **Task 1.7**: Implement `wrapActionResponse(handlerResult, action, res)` — auto-wraps in `{data: ...}` with `status ?? 200`; skips wrap if `res.headersSent`. Default `null` for `undefined` return.
- [ ] **Task 1.8**: Implement `assertNoActionCollisions(model, options)` — throws synchronously on:
  - Action name doesn't match `/^[A-Za-z][A-Za-z0-9_-]+$/` (incl. empty names).
  - Action name matches a Mongoose array-field path (would collide with `POST /:id/:field` at `api.ts:1159–1175`).
- [ ] **Task 1.9**: Implement `createActionOpenApiMiddleware({action, scope, actionName, model})` in `api/src/actions.ts`. Per-request middleware that on first request through the route calls `options.openApi.path()` with an Operation Object built from inlined Zod-derived schemas (`OpenApiGeneratorV3.generateSchema()`). No-op when `options.openApi` is undefined. Sets `operationId: '${tag}_${actionName}'`. Tag defaults to `model.collection.collectionName`.
- [ ] **Task 1.10**: Implement `registerActionRoutes(router, model, options)` — composes the middleware chain in order: `authenticateMiddleware(options.allowAnonymous)` → action OpenAPI middleware → pre-doc `runActionPermissions` → (instance only) `loadDocOr404` + post-doc `runActionPermissions` → `validateActionRequest` → wrapped `asyncHandler(action.handler)` → `wrapActionResponse`.
- [ ] **Task 1.11**: Extend `ModelRouterOptions<T>` in `api/src/api.ts` with `instanceActions?` and `collectionActions?`. Inside `_buildModelRouter`, call `assertNoActionCollisions` and `registerActionRoutes` in the pre-CRUD `endpoints` slot (before the user's `options.endpoints` callback runs, so actions take precedence on path conflicts).
- [ ] **Task 1.12**: Re-export `ActionContext`, `InstanceActionConfig`, `CollectionActionConfig`, `defineInstanceAction`, `defineCollectionAction` from `api/src/index.ts`.
- [ ] **Task 1.13**: Write tests in `api/src/actions.test.ts` covering all Phase 1 acceptance criteria: registration validation (missing perms throws, empty perms registers but returns 405, action-name regex, array-field collision, empty name); routing (instance + collection happy path for GET + POST; `ctx.doc` set on instance; `req.obj` set on instance for parity with CRUD); permission flow (pre-doc → 405, post-doc → 403, 401 from passport, `IsAuthenticatedOrReadOnly` GET works with `allowAnonymous: true`, `IsOwner` doc-aware); validation (good body, bad body → 400 with `meta.fields`, query schema, Zod coercion through `ctx`, `req.query` not mutated, Zod `.strip` default observed); response shape (envelope, custom `status`, null/undefined return, `res.headersSent` escape hatch, custom list-style envelope via `res.json` + return); doc loading (404 missing, 404 metadata on soft-deleted); **type ergonomics**: a TS-level compile-only test that `defineInstanceAction<TDoc>({body: z.object({x: z.string()}), handler: async ({doc, body}) => {}})` infers `doc: TDoc` and `body: {x: string}` correctly.
- [ ] **Task 1.14**: Add a regression test for **co-registration**: a modelRouter using BOTH `instanceActions: {foo: ...}` AND `endpoints: (router) => router.get('/:id/foo', ...)` — assert that the action wins (registered first in the pre-CRUD slot, before user `options.endpoints`). Same test for `collectionActions` colliding with a user `endpoints` route. Documents the precedence.

## Phase 2: OpenAPI verification

- [ ] **Task 2.1**: Tests against the generated `openapi.json` for actions registered via `TerrenoApp`: operation appears under `paths`; correct method + path; default tag = `model.collection.collectionName`; per-action `tag` override; inlined request body schema; inlined response schema under configured status; `id` path param present for instance actions; deterministic `operationId`.
- [ ] **Task 2.2**: Same suite but for actions registered via the legacy `setupServer` path (`expressServer.ts:257`) — verifies the per-request OpenAPI emission fires on first hit and produces parity with the `TerrenoApp` path.

## Phase 3: Migration + dogfooding

- [ ] **Task 3.1**: Migrate `api/src/consentApp.ts` `/consent-forms` `endpoints` actions (scope: only those three actions; `/consents/*` routes at lines 195–457 are out of scope):
  - `generate` → `collectionActions.generate`, conditional on `aiConfig` (built at runtime into the `collectionActions` map before passing to `modelRouter`).
  - `translate` → `collectionActions.translate`, same conditional.
  - `/:id/publish` → `instanceActions.publish`.
- [ ] **Task 3.2**: Confirm all existing consent-form tests pass without modification.
- [ ] **Task 3.3**: Add a `markComplete` instance action and a `bulkComplete` collection action to `example-backend/src/api/todos.ts` to demonstrate both scopes (and document the Zod `.strict()` recommendation in the example).
- [ ] **Task 3.4**: Regenerate `example-frontend` SDK: `cd example-frontend && bun run sdk`.
- [ ] **Task 3.5**: Smoke-test: run `bun run backend:dev` and `bun run frontend:web` together; exercise both new todo actions end-to-end (curl + the regenerated hooks).

## Phase 4: Consumer compile-check + docs

- [ ] **Task 4.1**: Run `bun run compile` (and `bun run test` where present) in each in-repo consumer of `@terreno/api`: `admin-backend`, `admin-frontend`, `ai`, `api-health`, `feature-flags`, `mcp-server`, `rtk`, `example-backend`, `example-frontend`. Fix any breakage from the new deps.
- [ ] **Task 4.2**: Document in the explainer that `zod` is a `peerDependency` of `@terreno/api` — consumers must install Zod themselves (already true for `example-backend`). Note this in the changelog as a breaking install requirement.
- [ ] **Task 4.3**: Write `docs/explanation/model-router-actions.md` covering: motivation; call-site example; semantics (permission method mapping, 405 vs 403 status codes, response envelope, validation error wire shape at `meta.fields`, collision detection, Zod `.strict()` recommendation, concurrency caveat for action handlers, `queryFilter` not applied to instance auto-load); migration notes from hand-rolled `endpoints` actions.
- [ ] **Task 4.4**: Update `mcp-server/src/tools.ts` `generate_route` (and any related prompt in `prompts.ts`) to suggest `instanceActions`/`collectionActions`.
- [ ] **Task 4.5**: Bump `@terreno/api` package version in `api/package.json`. Prepare a changelog entry mentioning: the new feature, the new deps (`zod`, `@asteasolutions/zod-to-openapi`), the behavior-preserving permission middleware refactor, and the new `operationId`-based hook names in regenerated SDKs.

See `docs/implementationPlans/model-router-actions.md` for full details on each task.
