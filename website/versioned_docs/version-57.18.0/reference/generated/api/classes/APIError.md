APIError is a simple way to throw an error in an API route and control what is shown and the
HTTP code displayed. It follows the JSONAPI spec to standardize the fields,
allowing the UI to show more consistent, better error messages.

It uses the standard `Error` fields the way external tools (e.g. Sentry) expect:
- `message` is exactly `title` — a stable, human-readable summary of the problem type.
- `name` is the error type, derived from the subclass name, `code`, or `status`
  (e.g. a 404 becomes "NotFoundError").
- `cause` holds the wrapped original error, so linked exceptions keep their own stack.

```ts
 throw new APIError({
   title: "Only an admin can update that!",
   status: 403,
   code: "update-admin-error",
   detail: "You must be an admin to change that field"
 });
```

## Extends

- `Error`

## Extended by

- [`BadRequestError`](BadRequestError.md)
- [`UnauthorizedError`](UnauthorizedError.md)
- [`ForbiddenError`](ForbiddenError.md)
- [`NotFoundError`](NotFoundError.md)
- [`ConflictError`](ConflictError.md)
- [`ValidationError`](ValidationError.md)
- [`InternalServerError`](InternalServerError.md)
- [`ExecutorConflictError`](ExecutorConflictError.md)

## Constructors

### Constructor

> **new APIError**(`options`): `APIError`

#### Parameters

##### options

[`APIErrorOptions`](../interfaces/APIErrorOptions.md)

#### Returns

`APIError`

#### Overrides

`Error.constructor`

## Properties

### code

> **code**: `string` \| `undefined`

***

### detail

> **detail**: `string` \| `undefined`

***

### disableExternalErrorTracking?

> `optional` **disableExternalErrorTracking?**: `boolean`

***

### id

> **id**: `string` \| `undefined`

***

### isTerrenoAPIError

> `readonly` **isTerrenoAPIError**: `true` = `true`

***

### links

> **links**: \{ `about?`: `string`; `type?`: `string`; \} \| `undefined`

***

### meta

> **meta**: \{\[`id`: `string`\]: `unknown`; \} \| `undefined`

***

### source

> **source**: \{ `header?`: `string`; `parameter?`: `string`; `pointer?`: `string`; \} \| `undefined`

***

### status

> **status**: `number`

## Accessors

### error

#### Get Signature

> **get** **error**(): `unknown`

##### Deprecated

Use the standard `cause` field instead.

##### Returns

`unknown`

***

### title

#### Get Signature

> **get** **title**(): `string`

##### Returns

`string`

## Methods

### toJSON()

> **toJSON**(): [`APIErrorBody`](../interfaces/APIErrorBody.md)

#### Returns

[`APIErrorBody`](../interfaces/APIErrorBody.md)
