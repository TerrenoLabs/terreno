## Properties

### enqueue?

> `optional` **enqueue?**: [`AuditEnqueue`](../type-aliases/AuditEnqueue.md)

When set, persist is delegated (Cloud Tasks). Mongo is not written on the
request process. Diffs still run inline so before/after is captured now.

***

### processQueuePath?

> `optional` **processQueuePath?**: `string`

Worker URL path Cloud Tasks should POST to. Defaults to `/internal/audit-events`
when enqueue comes from env (`GCP_TASKS_AUDIT_QUEUE` + `AUDIT_TASKS_URL`).

***

### processQueueSecret?

> `optional` **processQueueSecret?**: `string`

Shared secret for POST on `processQueuePath`. Required when that path is set.

***

### retentionDays?

> `optional` **retentionDays?**: `number`

Mongo TTL in days. Omit or 0 = forever (no TTL index).
