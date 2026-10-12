## Extends

- [`FindExactlyOnePlugin`](FindExactlyOnePlugin.md)\<[`McpServiceTokenDocument`](McpServiceTokenDocument.md)\>.[`FindOneOrNonePlugin`](FindOneOrNonePlugin.md)\<[`McpServiceTokenDocument`](McpServiceTokenDocument.md)\>

## Extended by

- [`McpServiceTokenModel`](McpServiceTokenModel.md)

## Properties

### countActiveForUser

> **countActiveForUser**: (`this`, `userId`) => `Promise`\<`number`\>

#### Parameters

##### this

[`McpServiceTokenModel`](McpServiceTokenModel.md)

##### userId

`ObjectId`

#### Returns

`Promise`\<`number`\>

***

### issueFor

> **issueFor**: (`this`, `user`, `options`) => `Promise`\<\{ `mcpServiceToken`: [`McpServiceTokenDocument`](McpServiceTokenDocument.md); `token`: `string`; \}\>

#### Parameters

##### this

[`McpServiceTokenModel`](McpServiceTokenModel.md)

##### user

###### _id

\{ `toString`: `string`; \}

###### _id.toString

##### options

[`McpServiceTokenIssueOptions`](McpServiceTokenIssueOptions.md)

#### Returns

`Promise`\<\{ `mcpServiceToken`: [`McpServiceTokenDocument`](McpServiceTokenDocument.md); `token`: `string`; \}\>

***

### revokeForUser

> **revokeForUser**: (`this`, `user`, `tokenId`) => `Promise`\<[`McpServiceTokenDocument`](McpServiceTokenDocument.md) \| `null`\>

#### Parameters

##### this

[`McpServiceTokenModel`](McpServiceTokenModel.md)

##### user

###### _id

\{ `toString`: `string`; \}

###### _id.toString

##### tokenId

`ObjectId`

#### Returns

`Promise`\<[`McpServiceTokenDocument`](McpServiceTokenDocument.md) \| `null`\>

***

### verify

> **verify**: (`this`, `token`) => `Promise`\<[`McpServiceTokenDocument`](McpServiceTokenDocument.md) \| `null`\>

#### Parameters

##### this

[`McpServiceTokenModel`](McpServiceTokenModel.md)

##### token

`string`

#### Returns

`Promise`\<[`McpServiceTokenDocument`](McpServiceTokenDocument.md) \| `null`\>

## Methods

### findExactlyOne()

> **findExactlyOne**(`query`, `errorArgs?`): `Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`McpServiceTokenDocument`](McpServiceTokenDocument.md)\>

#### Parameters

##### query

`Record`\<`string`, `unknown`\>

##### errorArgs?

`Partial`\<[`APIErrorOptions`](APIErrorOptions.md)\>

#### Returns

`Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`McpServiceTokenDocument`](McpServiceTokenDocument.md)\>

#### Inherited from

[`FindExactlyOnePlugin`](FindExactlyOnePlugin.md).[`findExactlyOne`](FindExactlyOnePlugin.md#findexactlyone)

***

### findOneOrNone()

> **findOneOrNone**(`query`, `errorArgs?`): `Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`McpServiceTokenDocument`](McpServiceTokenDocument.md) \| `null`\>

#### Parameters

##### query

`Record`\<`string`, `unknown`\>

##### errorArgs?

`Partial`\<[`APIErrorOptions`](APIErrorOptions.md)\>

#### Returns

`Promise`\<`Document`\<`ObjectId`, `any`, `any`, `Record`\<`string`, `any`\>, \{ \}\> & [`McpServiceTokenDocument`](McpServiceTokenDocument.md) \| `null`\>

#### Inherited from

[`FindOneOrNonePlugin`](FindOneOrNonePlugin.md).[`findOneOrNone`](FindOneOrNonePlugin.md#findoneornone)
