> `const` **DEFAULT\_SESSION\_REVALIDATION\_INTERVAL\_MS**: `60000` = `60_000`

Default interval for the periodic socket session re-validation sweep (D1): 60
seconds. Sockets authenticate once at handshake; without a sweep, a revoked
session, an expired token, or a user subsequently disabled keeps streaming deltas
(including PHI) indefinitely.
