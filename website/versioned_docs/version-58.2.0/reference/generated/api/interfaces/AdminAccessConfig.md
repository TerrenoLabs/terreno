## Properties

### authorize?

> `optional` **authorize?**: (`args`) => `boolean` \| `Promise`\<`boolean`\>

Completely replaces the standard RBAC decision for this model.

#### Parameters

##### args

[`AdminAccessContext`](AdminAccessContext.md)

#### Returns

`boolean` \| `Promise`\<`boolean`\>

***

### isOwned?

> `optional` **isOwned?**: (`args`) => `boolean` \| `Promise`\<`boolean`\>

Determines whether the current user owns an instance for writeOwned access.

#### Parameters

##### args

###### instance

`unknown`

###### user

[`User`](User.md)

#### Returns

`boolean` \| `Promise`\<`boolean`\>

***

### resource?

> `optional` **resource?**: `string`

RBAC resource for the standard read/write/writeOwned controls. Defaults to
`admin<ModelName>` when that statement exists, then the legacy camel-cased model name.
