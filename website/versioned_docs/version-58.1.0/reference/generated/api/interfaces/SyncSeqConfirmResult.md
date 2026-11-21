Outcome of clearing pending claims from a stream's in-flight registry.

## Properties

### cleared

> **cleared**: `boolean`

True when at least one pending entry was actually removed. False means the claim
was already gone — for a `registered` claim that is the reaped-lease signature
(Task 9.17): the writer stalled past [PENDING\_CLAIM\_LEASE\_MS](../variables/PENDING_CLAIM_LEASE_MS.md),
`computeStableFrontier` reclaimed its seq, and the frontier has already advanced
past a seq whose write only just landed. Callers must re-stamp the document (see
`restampReapedSeq`) or log loudly rather than silently stranding it.
