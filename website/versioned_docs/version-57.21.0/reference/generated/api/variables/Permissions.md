> `const` **Permissions**: `object`

## Type Declaration

### IsAdmin

> **IsAdmin**: (`_method`, `user?`) => `boolean`

#### Parameters

##### \_method

[`RESTMethod`](../type-aliases/RESTMethod.md)

##### user?

[`User`](../interfaces/User.md)

#### Returns

`boolean`

### IsAny

> **IsAny**: () => `boolean`

#### Returns

`boolean`

### IsAuthenticated

> **IsAuthenticated**: (`_method`, `user?`) => `boolean`

#### Parameters

##### \_method

[`RESTMethod`](../type-aliases/RESTMethod.md)

##### user?

[`User`](../interfaces/User.md)

#### Returns

`boolean`

### IsAuthenticatedOrReadOnly

> **IsAuthenticatedOrReadOnly**: (`method`, `user?`) => `boolean`

#### Parameters

##### method

[`RESTMethod`](../type-aliases/RESTMethod.md)

##### user?

[`User`](../interfaces/User.md)

#### Returns

`boolean`

### IsOrganizationMember

> **IsOrganizationMember**: [`PermissionMethod`](../type-aliases/PermissionMethod.md)\<`unknown`\> = `isOrgMemberPermission`

Object-level permission for tenant-scoped documents: platform org actors must match the
current org context; everyone else needs an active Membership. With no object (list/create)
it returns true and defers to [OrganizationQueryFilter](OrganizationQueryFilter.md).

### IsOwner

> **IsOwner**: (`_method`, `user?`, `obj?`) => `boolean`

#### Parameters

##### \_method

[`RESTMethod`](../type-aliases/RESTMethod.md)

##### user?

[`User`](../interfaces/User.md)

##### obj?

`unknown`

#### Returns

`boolean`

### IsOwnerOrReadOnly

> **IsOwnerOrReadOnly**: (`method`, `user?`, `obj?`) => `boolean`

#### Parameters

##### method

[`RESTMethod`](../type-aliases/RESTMethod.md)

##### user?

[`User`](../interfaces/User.md)

##### obj?

`unknown`

#### Returns

`boolean`
