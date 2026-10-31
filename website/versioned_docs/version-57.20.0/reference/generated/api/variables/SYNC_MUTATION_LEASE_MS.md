> `const` **SYNC\_MUTATION\_LEASE\_MS**: `number`

C5 (FIX 6): a `pending` row older than this may be taken over by a fresh
delivery — the original claimant is assumed to have crashed between the
claim and finalizing the ledger row.
