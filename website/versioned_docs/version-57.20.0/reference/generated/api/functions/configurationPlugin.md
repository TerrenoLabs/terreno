> **configurationPlugin**(`schema`, `options?`): `void`

Mongoose schema plugin that adds singleton configuration behavior.

Adds:
- Pre-save hook enforcing exactly one non-deleted document (soft-delete aware
  when the schema has a `deleted` path, e.g. via `isDeletedPlugin`)
- `getConfig()` static: fetches or creates the singleton (full doc or keyed value)
- `updateConfig(updates)` static: patches the singleton via `findOneAndUpdate({$set})`
  with dotted paths (preserves sibling subdoc fields; tolerates legacy fields)
- `getSecretFields()` static: returns metadata for fields with `secret: true`
- `resolveSecrets(provider?)` static: resolves secret values into an in-memory map,
  using the plugin provider by default (never persists values)
- Hard-delete blockers (`deleteOne`/`deleteMany`/`findOneAndDelete`); soft deletes
  (setting `deleted: true`) are allowed

Soft deletes are allowed and a soft-deleted document does not block creating a
new singleton. The `_singleton` unique index is opt-in via
`enforceSingletonIndex` (default off).

Mark fields as secrets using schema path options. Pin a version with the
optional `secretVersion` option:
```typescript
const configSchema = new Schema({
  apiKey: {
    type: String,
    description: "Third-party API key",
    secret: true,
    secretName: "my-api-key",
    secretVersion: "3", // optional — resolves "latest" when omitted
  },
});
configSchema.plugin(configurationPlugin, {secretProvider: new EnvSecretProvider()});
```

## Parameters

### schema

`Schema`

### options?

[`ConfigurationPluginOptions`](../interfaces/ConfigurationPluginOptions.md)

## Returns

`void`
