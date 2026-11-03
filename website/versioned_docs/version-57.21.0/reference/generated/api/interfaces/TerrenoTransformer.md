## Type Parameters

### T

`T`

## Properties

### serialize?

> `optional` **serialize?**: (`obj`, `user?`) => `Partial`\<`T`\> \| `undefined`

#### Parameters

##### obj

`T`

##### user?

[`User`](User.md)

#### Returns

`Partial`\<`T`\> \| `undefined`

***

### transform?

> `optional` **transform?**: (`obj`, `method`, `user?`) => `Partial`\<`T`\> \| `undefined`

#### Parameters

##### obj

`Partial`\<`T`\>

##### method

`"create"` \| `"update"`

##### user?

[`User`](User.md)

#### Returns

`Partial`\<`T`\> \| `undefined`
