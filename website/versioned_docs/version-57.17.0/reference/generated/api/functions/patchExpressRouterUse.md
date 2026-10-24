> **patchExpressRouterUse**(): `void`

Patches `express.Router().use` so nested mounts (e.g. `router.use("/gpt/histories", ...)`)
record `__openApiMountPath` the same way `app.use` does. Without this, nested
modelRouter OpenAPI paths are omitted from `/openapi.json`.

Express 5's Router puts `use` a few prototypes up from the instance, so we walk
the chain until we find the own `use` descriptor.

## Returns

`void`
