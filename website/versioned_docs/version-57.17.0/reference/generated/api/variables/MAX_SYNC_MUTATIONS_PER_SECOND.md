> `const` **MAX\_SYNC\_MUTATIONS\_PER\_SECOND**: `100` = `100`

Task 9.20: the single orchestration both mutation transports run.

`POST /sync/mutate{,/batch}` and `sync:mutate{,Batch}` used to each carry their own copy
of the size-cap -> rate-limit -> validate -> apply sequence, and the socket budget lived
in a per-connection closure — so one user on N sockets got N times the budget, while the
HTTP window map was per-user but never evicted. Everything now funnels through
[runSyncMutation](../functions/runSyncMutation.md) / [runSyncBatch](../functions/runSyncBatch.md) against ONE per-user window map, so a
user's budget is theirs no matter how many sockets or HTTP requests they spread it over.

Multi-instance semantics: the window map is per PROCESS, so a deployment running N API
instances behind a load balancer grants up to N times this budget per user in the worst
case. That is intentional — this limiter exists to stop a runaway client from saturating
one process, not to meter fair use across a cluster. A cluster-wide limit needs shared
state (Redis) and belongs in front of the app, not here.
