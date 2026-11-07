Minimal logging surface used by the HTTP client utilities so consumers (and tests)
can inject their own logger. Defaults to the terreno logger.

## Properties

### debug

> **debug**: (`msg`, ...`args`) => `void`

#### Parameters

##### msg

`string`

##### args

...`unknown`[]

#### Returns

`void`

***

### error

> **error**: (`msg`, ...`args`) => `void`

#### Parameters

##### msg

`string`

##### args

...`unknown`[]

#### Returns

`void`

***

### warn

> **warn**: (`msg`, ...`args`) => `void`

#### Parameters

##### msg

`string`

##### args

...`unknown`[]

#### Returns

`void`
