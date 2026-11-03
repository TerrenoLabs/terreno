Options for ConfigurationApp.

## Properties

### basePath?

> `optional` **basePath?**: `string`

Base path for configuration routes. Defaults to "/configuration".

***

### fieldOverrides?

> `optional` **fieldOverrides?**: `Record`\<`string`, \{ `widget?`: `string`; \}\>

Per-field widget overrides (e.g., {"ai.systemPrompt": "markdown"}).

***

### model

> **model**: [`ConfigurationModelLike`](ConfigurationModelLike.md)

The Mongoose model with configurationPlugin applied.

***

### permissions?

> `optional` **permissions?**: [`ConfigurationPermissions`](ConfigurationPermissions.md)

Per-route permission overrides. Defaults to admin-only for every route when
omitted. Supply terreno permission functions (e.g. `[IsStaff]`) to expose
configuration to a consumer's own permission system.

***

### postUpdate?

> `optional` **postUpdate?**: [`ConfigurationPostUpdateHook`](../type-aliases/ConfigurationPostUpdateHook.md)

Hook run after an update is applied (audit logging).

***

### preUpdate?

> `optional` **preUpdate?**: [`ConfigurationPreUpdateHook`](../type-aliases/ConfigurationPreUpdateHook.md)

Hook run before an update is applied (validation/normalization).
