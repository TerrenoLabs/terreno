400 Bad Request with a "ValidationError" type, for request/schema validation failures.

## Extends

- [`APIError`](APIError.md)

## Constructors

### Constructor

> **new ValidationError**(`options`): `ValidationError`

#### Parameters

##### options

[`APIErrorSubclassOptions`](../type-aliases/APIErrorSubclassOptions.md)

#### Returns

`ValidationError`

#### Overrides

[`APIError`](APIError.md).[`constructor`](APIError.md#constructor)

## Properties

### code

> **code**: `string` \| `undefined`

#### Inherited from

[`APIError`](APIError.md).[`code`](APIError.md#code)

***

### detail

> **detail**: `string` \| `undefined`

#### Inherited from

[`APIError`](APIError.md).[`detail`](APIError.md#detail)

***

### disableExternalErrorTracking?

> `optional` **disableExternalErrorTracking?**: `boolean`

#### Inherited from

[`APIError`](APIError.md).[`disableExternalErrorTracking`](APIError.md#disableexternalerrortracking)

***

### id

> **id**: `string` \| `undefined`

#### Inherited from

[`APIError`](APIError.md).[`id`](APIError.md#id)

***

### isTerrenoAPIError

> `readonly` **isTerrenoAPIError**: `true` = `true`

#### Inherited from

[`APIError`](APIError.md).[`isTerrenoAPIError`](APIError.md#isterrenoapierror)

***

### links

> **links**: \{ `about?`: `string`; `type?`: `string`; \} \| `undefined`

#### Inherited from

[`APIError`](APIError.md).[`links`](APIError.md#links)

***

### meta

> **meta**: \{\[`id`: `string`\]: `unknown`; \} \| `undefined`

#### Inherited from

[`APIError`](APIError.md).[`meta`](APIError.md#meta)

***

### source

> **source**: \{ `header?`: `string`; `parameter?`: `string`; `pointer?`: `string`; \} \| `undefined`

#### Inherited from

[`APIError`](APIError.md).[`source`](APIError.md#source)

***

### status

> **status**: `number`

#### Inherited from

[`APIError`](APIError.md).[`status`](APIError.md#status)

## Accessors

### error

#### Get Signature

> **get** **error**(): `unknown`

##### Deprecated

Use the standard `cause` field instead.

##### Returns

`unknown`

#### Inherited from

[`APIError`](APIError.md).[`error`](APIError.md#error)

***

### title

#### Get Signature

> **get** **title**(): `string`

##### Returns

`string`

#### Inherited from

[`APIError`](APIError.md).[`title`](APIError.md#title)

## Methods

### toJSON()

> **toJSON**(): [`APIErrorBody`](../interfaces/APIErrorBody.md)

#### Returns

[`APIErrorBody`](../interfaces/APIErrorBody.md)

#### Inherited from

[`APIError`](APIError.md).[`toJSON`](APIError.md#tojson)
