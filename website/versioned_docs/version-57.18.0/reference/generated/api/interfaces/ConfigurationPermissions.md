Per-route permission overrides for ConfigurationApp. Each value is an array of
terreno permission functions ([PermissionMethod](../type-aliases/PermissionMethod.md)), AND-combined like
`modelRouter` permissions. When a route is omitted, the default admin-only
guard applies.

## Example

```typescript
permissions: {
  read: [IsStaff],
  update: [IsSuperUser],
}
```

## Properties

### listSecrets?

> `optional` **listSecrets?**: [`PermissionMethod`](../type-aliases/PermissionMethod.md)\<`unknown`\>[]

Guards `POST {basePath}/list-secrets` and `/validate-secrets`.

***

### meta?

> `optional` **meta?**: [`PermissionMethod`](../type-aliases/PermissionMethod.md)\<`unknown`\>[]

Guards `GET {basePath}/meta` (schema metadata).

***

### read?

> `optional` **read?**: [`PermissionMethod`](../type-aliases/PermissionMethod.md)\<`unknown`\>[]

Guards `GET {basePath}` (current values).

***

### update?

> `optional` **update?**: [`PermissionMethod`](../type-aliases/PermissionMethod.md)\<`unknown`\>[]

Guards `PATCH {basePath}` (update values).
