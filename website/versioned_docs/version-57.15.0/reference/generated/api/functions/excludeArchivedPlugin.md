> **excludeArchivedPlugin**(`schema`, `defaultValue?`): `void`

Adds an `archived` boolean field and excludes archived documents from `find()` / `findOne()`
queries by default. Pass `{archived: true}` explicitly to include them. This is a soft-archive
analog to [isDeletedPlugin](isDeletedPlugin.md): use it when documents should be hidden from normal listings
but kept (and still directly queryable) rather than treated as deleted.

## Parameters

### schema

`Schema`\<`any`, `any`, `any`, `any`\>

Mongoose Schema

### defaultValue?

`boolean` = `false`

Default value for the `archived` field (defaults to `false`)

## Returns

`void`
