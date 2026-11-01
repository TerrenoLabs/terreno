## Properties

### apiName

> **apiName**: `string`

***

### logger?

> `optional` **logger?**: [`HttpClientLogger`](HttpClientLogger.md)

***

### operation

> **operation**: `string`

***

### redactError?

> `optional` **redactError?**: (`normalized`) => [`NormalizedApiError`](NormalizedApiError.md)

#### Parameters

##### normalized

[`NormalizedApiError`](NormalizedApiError.md)

#### Returns

[`NormalizedApiError`](NormalizedApiError.md)

***

### rethrowAs?

> `optional` **rethrowAs?**: `"raw"` \| `"apiError"`
