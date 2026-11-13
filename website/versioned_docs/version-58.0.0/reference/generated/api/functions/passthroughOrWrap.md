> **passthroughOrWrap**(`error`, `wrapper`): [`APIError`](../classes/APIError.md)

Picks the error to throw for something caught in a hook, transformer, or Mongoose middleware.
An `APIError` is passed through untouched so its status, code, detail, and meta reach the client;
anything else is wrapped in the given framework error. `wrapper` may override any field,
including `detail`, which defaults to the caught error's text.

## Parameters

### error

`unknown`

### wrapper

[`APIErrorOptions`](../interfaces/APIErrorOptions.md)

## Returns

[`APIError`](../classes/APIError.md)
