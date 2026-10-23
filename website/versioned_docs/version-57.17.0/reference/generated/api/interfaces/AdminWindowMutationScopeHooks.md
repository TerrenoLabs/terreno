## Extended by

- [`AdminWindowMutationScope`](AdminWindowMutationScope.md)

## Properties

### postCreate?

> `optional` **postCreate?**: (`value`, `request`) => `void` \| `Promise`\<`void`\>

#### Parameters

##### value

`unknown`

##### request

`Request`

#### Returns

`void` \| `Promise`\<`void`\>

***

### postDelete?

> `optional` **postDelete?**: (`request`, `value`) => `void` \| `Promise`\<`void`\>

#### Parameters

##### request

`Request`

##### value

`unknown`

#### Returns

`void` \| `Promise`\<`void`\>

***

### postUpdate?

> `optional` **postUpdate?**: (`value`, `cleanedBody`, `request`, `prevValue`) => `void` \| `Promise`\<`void`\>

#### Parameters

##### value

`unknown`

##### cleanedBody

`Partial`\<`T`\>

##### request

`Request`

##### prevValue

`unknown`

#### Returns

`void` \| `Promise`\<`void`\>

***

### preCreate?

> `optional` **preCreate?**: (`value`, `request`) => `unknown`

#### Parameters

##### value

`Partial`\<`unknown`\> \| (`Partial`\<`unknown`\> \| `undefined`)[] \| `null` \| `undefined`

##### request

`Request`

#### Returns

`unknown`

***

### preDelete?

> `optional` **preDelete?**: (`value`, `request`) => `unknown`

#### Parameters

##### value

`unknown`

##### request

`Request`

#### Returns

`unknown`

***

### preUpdate?

> `optional` **preUpdate?**: (`value`, `request`) => `unknown`

#### Parameters

##### value

`Partial`\<`T`\>

##### request

`Request`

#### Returns

`unknown`
