Metadata for a secret field discovered by the configuration plugin.

## Properties

### path

> **path**: `string`

***

### secretName

> **secretName**: `string`

***

### secretProvider?

> `optional` **secretProvider?**: `string`

***

### version?

> `optional` **version?**: `string`

Optional secret version to pin resolution to. When omitted the provider
resolves the latest version. Discovered from the `secretVersion` schema
path option.
