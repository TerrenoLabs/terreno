> **passthroughOrWrapWrite**(`error`, `wrapper`): [`APIError`](../classes/APIError.md)

`passthroughOrWrap` for write paths (`model.create`, `doc.save`). Mongoose validation and cast
errors are converted first so their per-field messages survive as `meta.fields` instead of being
flattened into the wrapper's `detail`.

## Parameters

### error

`unknown`

### wrapper

[`APIErrorOptions`](../interfaces/APIErrorOptions.md)

## Returns

[`APIError`](../classes/APIError.md)
