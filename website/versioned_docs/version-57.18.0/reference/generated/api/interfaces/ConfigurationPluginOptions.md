Options passed to configurationPlugin.

## Properties

### enforceSingletonIndex?

> `optional` **enforceSingletonIndex?**: `boolean`

When `true`, adds a `_singleton` sentinel field with a unique index to
enforce the singleton constraint at the database level.

Defaults to `false`. Leave this off when the consuming app already enforces
a single non-deleted document via the pre-save guard (the default behavior)
or via its own indexes/soft-delete plugin, to avoid double-enforcement and
conflicting indexes.

#### Default Value

```ts
false
```

***

### secretProvider?

> `optional` **secretProvider?**: [`SecretProvider`](SecretProvider.md)

Secret provider used when resolveSecrets() is called without an explicit provider.
Typically set during app startup so the model can resolve secrets on demand.
