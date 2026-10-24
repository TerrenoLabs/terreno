## Type Parameters

### TDoc

`TDoc`

## Properties

### adminBypass?

> `optional` **adminBypass?**: (`args`) => `boolean` \| `Promise`\<`boolean`\>

#### Parameters

##### args

[`ScopeArgs`](ScopeArgs.md)\<`TDoc`\>

#### Returns

`boolean` \| `Promise`\<`boolean`\>

***

### fieldOf?

> `optional` **fieldOf?**: (`doc`, `path`) => `unknown`

#### Parameters

##### doc

`TDoc`

##### path

`string`

#### Returns

`unknown`

***

### matches

> **matches**: (`args`) => `Record`\<`string`, `unknown`\> \| `Promise`\<`Record`\<`string`, `unknown`\> \| `null`\> \| `null`

#### Parameters

##### args

[`ScopeArgs`](ScopeArgs.md)\<`TDoc`\>

#### Returns

`Record`\<`string`, `unknown`\> \| `Promise`\<`Record`\<`string`, `unknown`\> \| `null`\> \| `null`
