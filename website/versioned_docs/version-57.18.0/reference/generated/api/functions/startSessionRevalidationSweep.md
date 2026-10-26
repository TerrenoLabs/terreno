> **startSessionRevalidationSweep**(`io`, `optionsOrThunk?`): [`SessionRevalidationHandle`](../type-aliases/SessionRevalidationHandle.md)

Start the periodic sweep (D1). Returns a handle to stop it (called from
`RealtimeApp.close()`). A `intervalMs` of 0 disables the sweep (useful for tests
that don't want a background timer).

`options` may be a plain object or a thunk resolved fresh on EVERY tick — pass a
thunk when any field (notably `sync`, whose `getUserScopes` resolver is published
by the `SyncApp` plugin and may not be registered yet, or may change, at the time
`RealtimeApp.onServerCreated()` runs) must never go stale for the lifetime of the
sweep, mirroring the per-handshake freshness `createLegacyJwtValidator`'s issuer
thunk already provides.

## Parameters

### io

`Server`

### optionsOrThunk?

[`SessionRevalidationOptions`](../interfaces/SessionRevalidationOptions.md) & `object` \| (() => [`SessionRevalidationOptions`](../interfaces/SessionRevalidationOptions.md) & `object`)

## Returns

[`SessionRevalidationHandle`](../type-aliases/SessionRevalidationHandle.md)
