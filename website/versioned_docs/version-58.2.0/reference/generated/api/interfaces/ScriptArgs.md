Typed, ergonomic accessor over the parsed arguments passed to a script. Scripts
read values via the typed getters; `raw` and `positional` expose everything for
advanced cases.

## Properties

### getBoolean

> **getBoolean**: (`name`, `fallback?`) => `boolean`

Read a boolean value ("true"/"1"/"yes"/"on" are truthy).

#### Parameters

##### name

`string`

##### fallback?

`boolean`

#### Returns

`boolean`

***

### getNumber

> **getNumber**: (`name`, `fallback?`) => `number` \| `undefined`

Read a numeric value (coerces strings; returns fallback when missing/NaN).

#### Parameters

##### name

`string`

##### fallback?

`number`

#### Returns

`number` \| `undefined`

***

### getString

> **getString**: (`name`, `fallback?`) => `string` \| `undefined`

Read a string value (coerces numbers/booleans; first element of arrays).

#### Parameters

##### name

`string`

##### fallback?

`string`

#### Returns

`string` \| `undefined`

***

### getStringArray

> **getStringArray**: (`name`) => `string`[]

Read a string array (single values become a one-element array).

#### Parameters

##### name

`string`

#### Returns

`string`[]

***

### has

> **has**: (`name`) => `boolean`

Whether a named argument was supplied (or has a default).

#### Parameters

##### name

`string`

#### Returns

`boolean`

***

### positional

> **positional**: `string`[]

Positional (non-flag) arguments, in order.

***

### raw

> **raw**: `Record`\<`string`, [`ScriptArgValue`](../type-aliases/ScriptArgValue.md)\>

All named values keyed by canonical name.
