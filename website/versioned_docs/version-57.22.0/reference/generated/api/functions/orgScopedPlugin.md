> **orgScopedPlugin**(`schema`): `void`

Adds a required indexed `organizationId` so tenant-scoped consumer models cannot be saved
without an organization. After creation, `organizationId` is immutable for REST, admin,
sync, and direct saves.

## Parameters

### schema

`Schema`

## Returns

`void`
