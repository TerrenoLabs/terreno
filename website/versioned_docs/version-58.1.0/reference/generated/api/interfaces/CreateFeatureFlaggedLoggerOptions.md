## Properties

### gateCatch?

> `optional` **gateCatch?**: `boolean`

When false (default), `catch` always forwards to `target` so `promise.catch(log.catch)` still
records errors when the flag is off. Set true to gate `catch` the same as other levels.

***

### isEnabled

> **isEnabled**: () => `boolean`

When this returns true, log calls are forwarded to `target`. Invoked on every call so flags
can flip without process restart (env, database-backed flags, `@terreno/feature-flags`, etc.).

#### Returns

`boolean`

***

### target?

> `optional` **target?**: [`ScopedLogger`](ScopedLogger.md)

Defaults to global `logger`; pass `createScopedLogger({...})` for gated diagnostic blocks.
