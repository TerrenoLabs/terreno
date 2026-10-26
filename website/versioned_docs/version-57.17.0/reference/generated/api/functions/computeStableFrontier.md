> **computeStableFrontier**(`__namedParameters`): `Promise`\<`number`\>

C1: the stable frontier for a stream — the highest seq below which no claim is
uncommitted. A cursor (snapshot or delta) may advance to seq N only when N is at
or below this value, so no committed document is ever permanently skipped.

frontier = `min(live pending.seq) - 1`, or the head `seq` when no live pending
entries remain. A pending entry older than [PENDING\_CLAIM\_LEASE\_MS](../variables/PENDING_CLAIM_LEASE_MS.md) is
considered abandoned (crashed writer): it is excluded from the min AND `$pull`ed
opportunistically so a crash cannot freeze the frontier forever.

## Parameters

### \_\_namedParameters

#### stream

`string`

## Returns

`Promise`\<`number`\>
