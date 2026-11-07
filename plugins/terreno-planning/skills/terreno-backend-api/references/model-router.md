# modelRouter — Terreno

## Registration signatures

```typescript
// TerrenoApp (recommended):
const todoRouter = modelRouter("/todos", Todo, options);
app.register(todoRouter);

// setupServer (legacy):
router.use("/todos", modelRouter(Todo, options));
```

## Full options reference

```typescript
modelRouter("/todos", Todo, {
  permissions: {
    create: [Permissions.IsAuthenticated],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsOwner],
    update: [Permissions.IsOwner],
    delete: [],  // disabled
  },
  queryFields: ["completed", "ownerId"],
  queryFilter: OwnerQueryFilter,
  sort: "-created",
  defaultLimit: 100,
  maxLimit: 500,
  populatePaths: [{path: "ownerId", fields: ["name", "email"]}],
  preCreate: (body, req) => ({...body, ownerId: req.user?._id}),
  preUpdate: (body, req) => body,
  postCreate: (doc, req) => {},
  postUpdate: (doc, body, req, prev) => {},
  postDelete: (req, doc) => {},
  responseHandler: (value, method, req, options) => value,
  validation: {
    validateCreate: true,
    validateUpdate: true,
    validateQuery: true,
    excludeFromCreate: ["ownerId"],
    excludeFromUpdate: ["ownerId"],
  },
  sync: {scope: {type: "owner"}},
  collectionActions: {
    bulkComplete: {
      method: "POST",
      permissions: [Permissions.IsAuthenticated],
      body: z.object({ids: z.array(z.string()).min(1)}).strict(),
      response: z.object({matched: z.number(), modified: z.number()}).strict(),
      summary: "Mark multiple todos complete",
      handler: async ({body, user}) => { /* ... */ },
    },
  },
  instanceActions: {
    markComplete: {
      method: "POST",
      permissions: [Permissions.IsOwner],
      summary: "Mark a single todo complete",
      handler: async ({doc}) => { /* ... */ },
    },
  },
  collectionActions: { /* named GET/POST on /todos/{name} */ },
  instanceActions: { /* named GET/POST on /todos/:id/{name} */ },
  // Last resort only — prefer collectionActions / instanceActions.
  endpoints: (router) => {
    // Custom routes registered before CRUD
  },
});
```

## Query features

- Pagination: `?limit=20&page=2`
- Sort: `?sort=-created`
- Filters: `?completed=true` (field must be in `queryFields`)
- Complex: `?$and=[{...}]`, `?$or=[{...}]`

## Lifecycle hooks

| Hook | When | Use for |
|------|------|---------|
| `preCreate` | Before insert | Set `ownerId`, defaults |
| `preUpdate` | Before patch | Strip immutable fields |
| `postCreate` | After insert | Side effects, notifications |
| `postUpdate` | After patch | Audit, cache invalidation |
| `postDelete` | After delete | Cleanup |

## User casting in callbacks

```typescript
const user = u as unknown as UserDocument;
// or in route handlers:
(req.user as unknown as UserDocument)?._id
```

Never use `as any as UserDocument`.

## Plugins on schemas

| Plugin | Adds |
|--------|------|
| `createdUpdatedPlugin` | `created`, `updated` timestamps |
| `isDeletedPlugin` | Soft delete (`deleted` field) |
| `findExactlyOne` | Static that throws on 0 or >1 match |
| `findOneOrNone` | Static that returns null on 0, throws on >1 |

## OpenAPI

`setupServer` / `TerrenoApp` auto-generates `/openapi.json`. Field `description` on schema paths flows to the spec via `mongoose-to-swagger`.

After any model or router change, regenerate the frontend SDK.
