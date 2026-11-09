Options for GcpSecretProvider.

## Properties

### loadModule?

> `optional` **loadModule?**: () => `Promise`\<`SecretManagerModule`\>

Loads the optional `@google-cloud/secret-manager` peer. Overridable so tests can exercise
the "peer not installed" path without depending on whether the install layout happens to
expose the package.

#### Returns

`Promise`\<`SecretManagerModule`\>

***

### projectId

> **projectId**: `string`

GCP project ID. Required for short secret names.
