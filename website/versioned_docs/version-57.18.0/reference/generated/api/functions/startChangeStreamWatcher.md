> **startChangeStreamWatcher**(`io`, `config?`, `debug?`): `void`

Start watching MongoDB change streams and emitting real-time events.

Task 9.16: the stream is supervised — an `error`/`close`/`end` schedules a re-open with
exponential backoff, resuming from the last seen token. Call
[stopChangeStreamWatcher](stopChangeStreamWatcher.md) to end supervision.

## Parameters

### io

`Server`

### config?

[`ChangeStreamConfig`](../interfaces/ChangeStreamConfig.md) = `{}`

### debug?

`boolean` = `false`

## Returns

`void`
