> **isWriteKeyForField**(`key`, `field`): `boolean`

True when a write-body key addresses `field` itself or a path inside it. Mongoose `set`,
`create`, and the document constructor treat a dotted key such as `roles.0` as a path into
`roles`, so field filters must match the first path segment, not only the exact key.

## Parameters

### key

`string`

### field

`string`

## Returns

`boolean`
