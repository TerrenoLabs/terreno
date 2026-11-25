> `const` **PENDING\_CLAIM\_LEASE\_MS**: `number`

C1: a `pending` claim older than this is treated as abandoned (the writer
crashed between claiming and confirming) and excluded from the frontier — a
crashed writer must never freeze the frontier forever. Default 60s.
