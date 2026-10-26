> **patchAppUse**(`app`): `void`

Wraps an Express app's `use` method to record the mount path on each
layer added to the router stack. This runs at setup time so that
`patchRouterStack` can read the original path later.

Must be called before any routes are registered.

## Parameters

### app

`Application`

## Returns

`void`
