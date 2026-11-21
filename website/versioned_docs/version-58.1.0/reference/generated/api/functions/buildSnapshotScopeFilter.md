> **buildSnapshotScopeFilter**(`__namedParameters`): `Record`\<`string`, `unknown`\>

C2: build the server-enforced scope filter for a SINGLE stream. The stream's scope
value has already been verified against the user's membership set by the caller, so
this filters to exactly that one value (`{field: value}`), never an `$in`.

Custom-resolver scopes cannot be inverted into a query field, so they still route
through the required `snapshotFilter` (parameterized by the user, as before).

Task 9.19: for owner/tenant/broadcast scopes a consumer-supplied `snapshotFilter` used
to be computed and then discarded — silently widening the snapshot past what the
consumer asked for. It is now composed with the scope clause via `$and` (never
spread-merged, which would let one clobber the other).

## Parameters

### \_\_namedParameters

#### entry

[`SyncRegistryEntry`](../interfaces/SyncRegistryEntry.md)

#### scopeValue

`string` \| `null`

#### snapshotFilterResult?

`Record`\<`string`, `unknown`\>

## Returns

`Record`\<`string`, `unknown`\>
