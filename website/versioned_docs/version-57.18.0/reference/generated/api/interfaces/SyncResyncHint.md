Payload of the `sync:resync-required` socket event (Task 9.16).

Emitted server-wide when the change stream could not be resumed — the oplog no longer
contains the resume point, so the events in the gap can never be delivered. Any cursor a
client holds may now sit below changes (including deletions) it will never be told about,
so the only safe response is to re-bootstrap every stream. Clients that do not handle the
event still converge on their next full bootstrap; handling it just makes that immediate.

## Properties

### reason

> **reason**: `"history_lost"`

Why the resync is needed. Only `history_lost` exists today.
