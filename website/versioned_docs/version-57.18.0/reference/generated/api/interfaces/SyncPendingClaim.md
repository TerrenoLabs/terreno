An uncommitted seq claim recorded on the counter's in-flight registry (C1).

## Properties

### claimedAt

> **claimedAt**: `Date`

When the claim was registered; a claim older than the lease is reclaimable.

***

### seq

> **seq**: `number`

The claimed seq (or, for a batch, one entry per claimed seq).
