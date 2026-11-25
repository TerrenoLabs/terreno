## Properties

### apiName?

> `optional` **apiName?**: `string`

***

### auth

> **auth**: [`AuthStrategy`](../type-aliases/AuthStrategy.md)

***

### baseURL

> **baseURL**: `string`

***

### logger?

> `optional` **logger?**: [`HttpClientLogger`](HttpClientLogger.md)

***

### redactError?

> `optional` **redactError?**: (`normalized`) => [`NormalizedApiError`](NormalizedApiError.md)

#### Parameters

##### normalized

[`NormalizedApiError`](NormalizedApiError.md)

#### Returns

[`NormalizedApiError`](NormalizedApiError.md)

***

### retry?

> `optional` **retry?**: `Partial`\<[`RetryPolicy`](RetryPolicy.md)\>
